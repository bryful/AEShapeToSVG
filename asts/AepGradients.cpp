#include "AepGradients.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <locale>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <vector>

namespace asts {
namespace {
using J = nlohmann::json;
struct Chunk { std::string tag, kind; size_t begin, end; std::vector<Chunk> children; };
struct Reader {
    std::string data;
    size_t count = 0;
    unsigned Number(size_t p) const {
        if (p + 4 > data.size()) throw std::runtime_error("Truncated AEP");
        unsigned n = 0;
        for (size_t i = 0; i < 4; ++i) n = (n << 8) | static_cast<unsigned char>(data[p+i]);
        return n;
    }
    std::vector<Chunk> Chunks(size_t begin, size_t end, int depth = 0) {
        if (depth > 128) throw std::runtime_error("AEP depth limit");
        std::vector<Chunk> result;
        for (size_t p = begin; p < end;) {
            if (end - p < 8 || ++count > 1000000) throw std::runtime_error("Invalid AEP chunk");
            size_t n = Number(p+4);
            if (n > end-p-8) throw std::runtime_error("AEP chunk exceeds parent");
            size_t stop = p+8+n;
            Chunk c{data.substr(p,4), "", p+8, stop, {}};
            if (c.tag == "LIST") {
                if (n < 4) throw std::runtime_error("Invalid AEP LIST");
                c.kind = data.substr(p+8,4);
                // AE also uses LIST for opaque payloads, e.g. btdk font/text data.
                // Only these containers are needed to reach gradient properties.
                if (c.kind == "Fold" || c.kind == "Item" || c.kind == "Layr" ||
                    c.kind == "tdgp" || c.kind == "GCst" || c.kind == "GCky" || c.kind == "tdbs")
                    c.children = Chunks(p+12, stop, depth+1);
            } else if (c.tag == "tdsn") {
                c.children = Chunks(p+8, stop, depth+1);
            }
            result.push_back(std::move(c));
            p = stop + (n & 1);
            if (p > end) throw std::runtime_error("Invalid AEP padding");
        }
        return result;
    }
    std::string Text(const Chunk &c) const {
        auto s = data.substr(c.begin, c.end-c.begin);
        while (!s.empty() && s.back() == '\0') s.pop_back();
        return s;
    }
};
double Finite(double x) {
    if (!std::isfinite(x)) throw std::runtime_error("Non-finite gradient value");
    return x;
}
double Unit(double x) {
    Finite(x);
    if (x < 0 || x > 1) throw std::runtime_error("Gradient value outside 0..1");
    return x;
}
J Stops(const std::string &xml, const std::string &key, size_t length) {
    std::regex arrays("<key>"+key+"</key>\\s*<array>([\\s\\S]*?)</array>");
    std::regex floats("<float>([^<]+)</float>");
    J result = J::array();
    for (auto i = std::sregex_iterator(xml.begin(),xml.end(),arrays); i != std::sregex_iterator(); ++i) {
        auto text = (*i)[1].str();
        J stop = J::array();
        for (auto f = std::sregex_iterator(text.begin(),text.end(),floats); f != std::sregex_iterator(); ++f) {
            size_t used = 0; auto value = (*f)[1].str(); double n = std::stod(value,&used);
            if (used != value.size()) throw std::runtime_error("Invalid gradient number");
            stop.push_back(Unit(n));
        }
        if (stop.size() != length) throw std::runtime_error("Invalid gradient stop length");
        result.push_back(stop);
    }
    if (result.size() < 2 || result.size() > 4096) throw std::runtime_error("Invalid gradient stop count");
    std::stable_sort(result.begin(),result.end(),[](const J&a,const J&b){return a[0].get<double>()<b[0].get<double>();});
    for (size_t i=0;i+1<result.size();++i)
    {
        if (result[i][0].get<double>() == result[i+1][0].get<double>())
            throw std::runtime_error("Coincident gradient stops unsupported");
        if (result[i][1].get<double>() <= 0 || result[i][1].get<double>() >= 1)
            throw std::runtime_error("Degenerate gradient midpoint");
    }
    return result;
}
void Gather(const Reader &r, const Chunk &c, std::vector<std::string> path, J &out) {
    bool composition = c.kind == "Item" && std::any_of(c.children.begin(), c.children.end(),
        [](const Chunk &child) { return child.kind == "Layr"; });
    if (composition || c.kind == "Layr") {
        for (const auto &child:c.children) if (child.tag == "Utf8") {path.push_back(r.Text(child));break;}
    } else if (c.kind == "tdgp") {
        for (const auto &child:c.children) if (child.tag == "tdsn")
            for (const auto &name:child.children) if (name.tag == "Utf8") {
                auto text=r.Text(name); if (!text.empty() && text!="-_0_/-") path.push_back(text);
            }
    }
    if (c.kind == "GCst") {
        J item={{"navigation",path},{"offset",c.begin-8},{"status","error"}};
        try {
            std::vector<std::string> xml;
            bool keyed=false;
            for (const auto &child:c.children) {
                if (child.kind=="GCky") for (const auto &value:child.children)
                    if (value.tag=="Utf8") xml.push_back(r.Text(value));
                // Static tdbs has no keyframe list. Unknown nested lists are rejected conservatively.
                if (child.kind=="tdbs") for(const auto &v:child.children) if(v.tag=="LIST") keyed=true;
            }
            if (keyed || xml.size()>1) throw std::runtime_error("GRADIENT_KEY_ANIMATION");
            if (xml.size()!=1 || xml[0].find("Gradient Color Data")==std::string::npos ||
                xml[0].find("</prop.map>")==std::string::npos) throw std::runtime_error("Missing gradient XML");
            item["colors"]=Stops(xml[0],"Stops Color",6);
            item["opacities"]=Stops(xml[0],"Stops Alpha",3);
            item["status"]="extracted";
        } catch(const std::exception &e) {item["error"]=e.what();}
        out.push_back(item);
        return;
    }
    for (const auto &child:c.children) Gather(r,child,path,out);
}
// AE midpoints are represented by an additional stop, as in Bodymovin.
J Expand(const J &stops, size_t components) {
    J out=J::array();
    for(size_t i=0;i<stops.size();++i) {
        const auto &s=stops[i]; J row=J::array({s[0]});
        for(size_t k=0;k<components;++k) row.push_back(s[k+2]);
        out.push_back(row);
        if(i+1<stops.size()) {
            const auto &next=stops[i+1];
            J middle=J::array({s[0].get<double>()+(next[0].get<double>()-s[0].get<double>())*s[1].get<double>()});
            for(size_t k=0;k<components;++k) middle.push_back((s[k+2].get<double>()+next[k+2].get<double>())*.5);
            out.push_back(middle);
        }
    }
    return out;
}
double Sample(const J &stops, double p, size_t component) {
    if(p<stops[0][0].get<double>()) return stops[0][component].get<double>();
    for(size_t i=1;i<stops.size();++i) if(p<stops[i][0].get<double>()) {
        double left=stops[i-1][0],right=stops[i][0];
        double t=(p-left)/(right-left);
        return stops[i-1][component].get<double>()*(1-t)+stops[i][component].get<double>()*t;
    }
    return stops.back()[component].get<double>();
}
} // namespace
J InspectGradients(const std::filesystem::path &input,double timeSeconds) {
    Finite(timeSeconds);
    if(std::filesystem::file_size(input)>512*1024*1024) throw std::runtime_error("AEP exceeds 512 MiB");
    std::ifstream in(input,std::ios::binary);
    if(!in) throw std::runtime_error("Cannot open AEP");
    Reader r; r.data.assign(std::istreambuf_iterator<char>(in),{});
    if(r.data.size()<12 || r.data.substr(0,4)!="RIFX" || r.data.substr(8,4)!="Egg!")
        throw std::runtime_error("Unsupported AEP header");
    size_t rootLength=r.Number(4);
    if(rootLength>r.data.size()-8) throw std::runtime_error("Truncated AEP root");
    size_t end=rootLength+8;
    if(end>r.data.size() || end<12) throw std::runtime_error("Truncated AEP root");
    auto chunks=r.Chunks(12,end);
    J gradients=J::array();
    for(const auto &c:chunks) Gather(r,c,{},gradients);
    return {{"format","ae-gradient-inspection"},{"timeSeconds",timeSeconds},{"gradients",gradients}};
}
void ResolveGradients(J &doc) {
    const auto &source=doc.at("source");
    J report; std::string projectError; bool loaded=false;
    auto load=[&]() {
        if(loaded)return;
        loaded=true;
        try {
            if(source.value("projectDirty",false)) throw std::runtime_error("Project has unsaved changes");
            if(!source.contains("projectFile") || !source["projectFile"].is_string()) throw std::runtime_error("Project not saved");
            auto utf8=source["projectFile"].get<std::string>();
            auto path=std::filesystem::path(std::u8string(utf8.begin(),utf8.end()));
            report=InspectGradients(path,source.at("evaluation").at("timeSeconds").get<double>());
        } catch(const std::exception &e) {projectError=e.what();}
    };
    std::function<void(J&,std::vector<std::string>)> visit;
    visit=[&](J &node,std::vector<std::string> path) {
        if(node.value("kind","")=="group")path.push_back(node.value("name",""));
        if(node.contains("gradientRequest")) {
            auto &request=node["gradientRequest"];
            try {
                if(request.value("keyframeCount",0)>0)throw std::runtime_error("GRADIENT_KEY_ANIMATION");
                if(request.contains("error"))throw std::runtime_error(request.at("error").get<std::string>());
                if(request.value("expressionEnabled",false))throw std::runtime_error("Gradient color expression unsupported");
                double time=source.at("evaluation").at("timeSeconds");
                if(!std::isfinite(time) || request.at("timeSeconds").get<double>()!=time)throw std::runtime_error("Gradient evaluation time mismatch");
                load(); if(!projectError.empty())throw std::runtime_error(projectError);
                path.push_back(node.at("name")); J found;size_t matches=0;
                for(const auto &g:report["gradients"])if(g.at("navigation")==J(path)){found=g;++matches;}
                if(matches!=1)throw std::runtime_error(matches?"Ambiguous gradient path":"Gradient path not found");
                if(found.at("status")!="extracted")throw std::runtime_error(found.at("error").get<std::string>());
                found["properties"]=request.at("properties");
                // Validate paint parameters now so errors fall back locally.
                GradientSvg(found,"validate");
                found["timeSeconds"]=time;node["gradient"]=found;
                request["status"]="resolved";node.erase("replacement");
            } catch(const std::exception &e) {
                node.erase("gradient");node["replacement"]="gradientToSolid";
                request["status"]="error";request["message"]=e.what();
                std::cerr<<"Gradient fallback: "<<node.value("name","")<<": "<<e.what()<<'\n';
            }
            return;
        }
        if(node.contains("children"))for(auto &child:node["children"])visit(child,path);
    };
    visit(doc.at("contents"),{source.value("composition",J::object()).value("name",""),source.at("layer").value("name","")});
}
std::string GradientSvg(const J &gradient,const std::string &id) {
    const auto &p=gradient.at("properties");
    auto start=p.at("ADBE Vector Grad Start Pt"),end=p.at("ADBE Vector Grad End Pt");
    if(!start.is_array()||!end.is_array()||start.size()!=2||end.size()!=2)throw std::runtime_error("Invalid gradient endpoints");
    double x=Finite(start[0]),y=Finite(start[1]),ex=Finite(end[0]),ey=Finite(end[1]);
    int type=p.at("ADBE Vector Grad Type");
    if(type!=1 && type!=2)throw std::runtime_error("Unknown gradient type");
    if(x==ex && y==ey)throw std::runtime_error("Coincident gradient endpoints");
    std::ostringstream svg;svg.imbue(std::locale::classic());svg<<std::setprecision(9);
    std::string tag=type==1?"linearGradient":"radialGradient";
    svg<<"  <"<<tag<<" id=\""<<id<<"\" gradientUnits=\"userSpaceOnUse\" color-interpolation=\"sRGB\" ";
    if(type==1)svg<<"x1=\""<<x<<"\" y1=\""<<y<<"\" x2=\""<<ex<<"\" y2=\""<<ey<<"\"";
    else {
        double r=std::hypot(ex-x,ey-y),length=Finite(p.value("ADBE Vector Grad HiLite Length",0.0))/100;
        double angle=std::atan2(ey-y,ex-x)+Finite(p.value("ADBE Vector Grad HiLite Angle",0.0))*std::acos(-1.0)/180;
        length=std::clamp(length,-.999,.999);
        svg<<"cx=\""<<x<<"\" cy=\""<<y<<"\" r=\""<<r<<"\" fx=\""<<x+r*length*std::cos(angle)<<"\" fy=\""<<y+r*length*std::sin(angle)<<"\"";
    }
    svg<<">\n";
    auto colors=Expand(gradient.at("colors"),3),alpha=Expand(gradient.at("opacities"),1);
    std::vector<double> positions;
    for(const auto &s:colors)positions.push_back(s[0]);
    for(const auto &s:alpha)positions.push_back(s[0]);
    std::sort(positions.begin(),positions.end());positions.erase(std::unique(positions.begin(),positions.end()),positions.end());
    for(double position:positions) {
        svg<<"    <stop offset=\""<<position<<"\" stop-color=\"rgb(";
        for(size_t k=1;k<=3;++k){if(k>1)svg<<',';svg<<std::round(Unit(Sample(colors,position,k))*255);}
        svg<<")\" stop-opacity=\""<<Unit(Sample(alpha,position,1))<<"\" />\n";
    }
    svg<<"  </"<<tag<<">\n";return svg.str();
}
} // namespace asts
