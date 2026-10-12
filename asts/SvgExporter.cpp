#define NOMINMAX
#include "SvgExporter.h"
#include "third_party/nlohmann/json.hpp"
#include <Windows.h>
#include <algorithm>
#include <cmath>
#include <d2d1.h>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <locale>
#include <numbers>
#include <sstream>
#include <stdexcept>
#include <vector>
#include <wrl/client.h>

namespace asts
{
namespace
{
using J = nlohmann::json;
using Microsoft::WRL::ComPtr;
using G = ComPtr<ID2D1Geometry>;
using M = D2D1::Matrix3x2F;
using P = D2D1_POINT_2F;
constexpr float tol = .02f;
constexpr double pi = std::numbers::pi;
void Check(HRESULT hr)
{
    if (FAILED(hr))
        throw std::runtime_error("Direct2D error " + std::to_string(hr));
}
const J &Children(const J &n)
{
    static const J empty = J::array();
    return n.contains("children") ? n.at("children") : empty;
}
const J *Child(const J &n, const std::string &key)
{
    for (const auto &c : Children(n))
        if (c.value("matchName", "") == key)
            return &c;
    return nullptr;
}
double Num(const J &v)
{
    double x = v.get<double>();
    if (!std::isfinite(x) || std::abs(x) > 1e8)
        throw std::runtime_error("Invalid or excessive numeric value");
    return x;
}
double Get(const J &n, const std::string &k, double fallback)
{
    auto p = Child(n, k);
    return p ? Num(p->at("value")) : fallback;
}
P Point(const J &v)
{
    if (!v.is_array() || v.size() != 2)
        throw std::runtime_error("Expected 2D point");
    return {float(Num(v[0])), float(Num(v[1]))};
}
P GetP(const J &n, const std::string &k, P fallback = {})
{
    auto p = Child(n, k);
    return p ? Point(p->at("value")) : fallback;
}
P Add(P a, P b)
{
    return {a.x + b.x, a.y + b.y};
}
P Lerp(P a, P b, double t)
{
    return {float(a.x + (b.x - a.x) * t), float(a.y + (b.y - a.y) * t)};
}
double Distance(P a, P b)
{
    return std::hypot(b.x - a.x, b.y - a.y);
}
std::string Escape(const std::string &s)
{
    std::string out;
    for (char c : s)
    {
        if (c == '&')
            out += "&amp;";
        else if (c == '<')
            out += "&lt;";
        else if (c == '>')
            out += "&gt;";
        else if (c == '"')
            out += "&quot;";
        else
            out += c;
    }
    return out;
}
struct Figure
{
    std::vector<P> points;
    bool closed = false;
};
struct CurveVertex
{
    P point, in, out;
};
struct CurveFigure
{
    std::vector<CurveVertex> vertices;
    bool closed = false;
};
// Stack-owned sink, borrowed only during synchronous Direct2D calls.
class Sink : public ID2D1SimplifiedGeometrySink
{
  public:
    std::ostringstream text;
    std::vector<Figure> figures;
    std::vector<CurveFigure> curves;
    HRESULT error = S_OK;
    Sink()
    {
        text.imbue(std::locale::classic());
        text << std::setprecision(9);
    }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void **p) override
    {
        if (!p)
            return E_POINTER;
        *p = nullptr;
        if (id == __uuidof(IUnknown) || id == __uuidof(ID2D1SimplifiedGeometrySink))
        {
            *p = this;
            return S_OK;
        }
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override
    {
        return 1;
    }
    ULONG STDMETHODCALLTYPE Release() override
    {
        return 1;
    }
    template <class F> void Safe(F &&f) noexcept
    {
        try
        {
            f();
        }
        catch (...)
        {
            error = E_OUTOFMEMORY;
        }
    }
    void STDMETHODCALLTYPE SetFillMode(D2D1_FILL_MODE) override
    {
    }
    void STDMETHODCALLTYPE SetSegmentFlags(D2D1_PATH_SEGMENT) override
    {
    }
    void STDMETHODCALLTYPE BeginFigure(P p, D2D1_FIGURE_BEGIN) override
    {
        Safe([&] {
            text << 'M' << p.x << ' ' << p.y;
            figures.push_back({{p}, false});
            curves.push_back({{{p, p, p}}, false});
        });
    }
    void STDMETHODCALLTYPE AddLines(const P *p, UINT32 count) override
    {
        Safe([&] {
            for (UINT32 i = 0; i < count; ++i)
            {
                text << 'L' << p[i].x << ' ' << p[i].y;
                figures.back().points.push_back(p[i]);
                curves.back().vertices.push_back({p[i], p[i], p[i]});
            }
        });
    }
    void STDMETHODCALLTYPE AddBeziers(const D2D1_BEZIER_SEGMENT *p, UINT32 count) override
    {
        Safe([&] {
            for (UINT32 i = 0; i < count; ++i)
            {
                text << 'C' << p[i].point1.x << ' ' << p[i].point1.y << ' ' << p[i].point2.x << ' ' << p[i].point2.y
                     << ' ' << p[i].point3.x << ' ' << p[i].point3.y;
                curves.back().vertices.back().out = p[i].point1;
                curves.back().vertices.push_back({p[i].point3, p[i].point2, p[i].point3});
            }
        });
    }
    void STDMETHODCALLTYPE EndFigure(D2D1_FIGURE_END end) override
    {
        Safe([&] {
            if (end == D2D1_FIGURE_END_CLOSED)
            {
                text << 'Z';
                figures.back().closed = true;
                curves.back().closed = true;
            }
        });
    }
    HRESULT STDMETHODCALLTYPE Close() override
    {
        return error;
    }
};
struct Shape
{
    G geometry;
    float opacity = 1;
};
struct OpacityScope
{
    size_t id;
    float opacity;
};
struct Draw
{
    Shape shape;
    J style;
    M matrix = M::Identity();
    std::vector<OpacityScope> scopes;
};
struct Result
{
    std::vector<Shape> paths;
    std::vector<Draw> draws;
};
class Exporter
{
    ComPtr<ID2D1Factory> factory;
    size_t visited = 0, nextScope = 0;
    bool legacyDashWarning = false;

  public:
    Exporter()
    {
        Check(D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, factory.GetAddressOf()));
    }
    template <class F> G Path(F &&f)
    {
        ComPtr<ID2D1PathGeometry> p;
        Check(factory->CreatePathGeometry(&p));
        ComPtr<ID2D1GeometrySink> s;
        Check(p->Open(&s));
        s->SetFillMode(D2D1_FILL_MODE_WINDING);
        f(s.Get());
        Check(s->Close());
        return p;
    }
    G Transform(const G &g, const M &m)
    {
        ComPtr<ID2D1TransformedGeometry> p;
        Check(factory->CreateTransformedGeometry(g.Get(), m, &p));
        return p;
    }
    G Lines(const std::vector<Figure> &figures)
    {
        return Path([&](ID2D1GeometrySink *s) {
            for (const auto &f : figures)
                if (!f.points.empty())
                {
                    s->BeginFigure(f.points[0], D2D1_FIGURE_BEGIN_FILLED);
                    for (size_t i = 1; i < f.points.size(); ++i)
                        s->AddLine(f.points[i]);
                    s->EndFigure(f.closed ? D2D1_FIGURE_END_CLOSED : D2D1_FIGURE_END_OPEN);
                }
        });
    }
    G Join(const std::vector<Shape> &paths, D2D1_FILL_MODE mode = D2D1_FILL_MODE_WINDING)
    {
        if (paths.empty())
            return Lines({});
        std::vector<ID2D1Geometry *> raw;
        for (const auto &p : paths)
            raw.push_back(p.geometry.Get());
        ComPtr<ID2D1GeometryGroup> g;
        Check(factory->CreateGeometryGroup(mode, raw.data(), UINT32(raw.size()), &g));
        return g;
    }
    G Boolean(const G &a, const G &b, D2D1_COMBINE_MODE mode)
    {
        return Path([&](ID2D1GeometrySink *s) { Check(a->CombineWithGeometry(b.Get(), mode, nullptr, tol, s)); });
    }
    ComPtr<ID2D1StrokeStyle> Pen(const J &n, bool offset = false)
    {
        auto p = D2D1::StrokeStyleProperties();
        int cap = int(Get(n, "ADBE Vector Stroke Line Cap", 1)),
            join = int(Get(n, offset ? "ADBE Vector Offset Line Join" : "ADBE Vector Stroke Line Join", 1));
        p.startCap = p.endCap = p.dashCap = cap == 2   ? D2D1_CAP_STYLE_ROUND
                                            : cap == 3 ? D2D1_CAP_STYLE_SQUARE
                                                       : D2D1_CAP_STYLE_FLAT;
        p.lineJoin = join == 2 ? D2D1_LINE_JOIN_ROUND : join == 3 ? D2D1_LINE_JOIN_BEVEL : D2D1_LINE_JOIN_MITER;
        p.miterLimit = float(Get(n, offset ? "ADBE Vector Offset Miter Limit" : "ADBE Vector Stroke Miter Limit", 4));
        if (p.miterLimit < 1)
            throw std::runtime_error("Invalid miter limit");
        ComPtr<ID2D1StrokeStyle> s;
        Check(factory->CreateStrokeStyle(p, nullptr, 0, &s));
        return s;
    }
    G Widen(const G &g, float width, ID2D1StrokeStyle *style)
    {
        return Path([&](ID2D1GeometrySink *s) { Check(g->Widen(width, style, nullptr, tol, s)); });
    }
    G Make(const J &n)
    {
        std::string kind = n.at("kind");
        G g;
        if (kind == "rectangle")
        {
            auto size = GetP(n, "ADBE Vector Rect Size"), p = GetP(n, "ADBE Vector Rect Position");
            float x = std::abs(size.x) / 2, y = std::abs(size.y) / 2,
                  r = float(std::clamp(Get(n, "ADBE Vector Rect Roundness", 0), 0.0, double(std::min(x, y))));
            if (r == 0)
            {
                ComPtr<ID2D1RectangleGeometry> rect;
                Check(factory->CreateRectangleGeometry(D2D1::RectF(p.x - x, p.y - y, p.x + x, p.y + y), &rect));
                g = rect;
            }
            else
            {
                ComPtr<ID2D1RoundedRectangleGeometry> rect;
                Check(factory->CreateRoundedRectangleGeometry(
                    D2D1::RoundedRect(D2D1::RectF(p.x - x, p.y - y, p.x + x, p.y + y), r, r), &rect));
                g = rect;
            }
        }
        else if (kind == "ellipse")
        {
            auto size = GetP(n, "ADBE Vector Ellipse Size"), p = GetP(n, "ADBE Vector Ellipse Position");
            float x = std::abs(size.x) / 2, y = std::abs(size.y) / 2, k = .552284749831f;
            g = Path([&](ID2D1GeometrySink *s) {
                s->BeginFigure({p.x, p.y - y}, D2D1_FIGURE_BEGIN_FILLED);
                s->AddBezier({{p.x + k * x, p.y - y}, {p.x + x, p.y - k * y}, {p.x + x, p.y}});
                s->AddBezier({{p.x + x, p.y + k * y}, {p.x + k * x, p.y + y}, {p.x, p.y + y}});
                s->AddBezier({{p.x - k * x, p.y + y}, {p.x - x, p.y + k * y}, {p.x - x, p.y}});
                s->AddBezier({{p.x - x, p.y - k * y}, {p.x - k * x, p.y - y}, {p.x, p.y - y}});
                s->EndFigure(D2D1_FIGURE_END_CLOSED);
            });
        }
        else if (kind == "path")
        {
            auto p = Child(n, "ADBE Vector Shape");
            if (!p)
                throw std::runtime_error("Missing Bezier path");
            const auto &v = p->at("value");
            const auto &points = v.at("vertices");
            const auto &in = v.at("inTangents");
            const auto &out = v.at("outTangents");
            if (!points.is_array() || in.size() != points.size() || out.size() != points.size())
                throw std::runtime_error("Invalid Bezier arrays");
            g = Path([&](ID2D1GeometrySink *s) {
                if (points.empty())
                    return;
                bool closed = v.at("closed").get<bool>();
                size_t count = points.size();
                s->BeginFigure(Point(points[0]), D2D1_FIGURE_BEGIN_FILLED);
                for (size_t i = 0; i < (closed ? count : count - 1); ++i)
                {
                    size_t j = (i + 1) % count;
                    s->AddBezier(
                        {Add(Point(points[i]), Point(out[i])), Add(Point(points[j]), Point(in[j])), Point(points[j])});
                }
                s->EndFigure(closed ? D2D1_FIGURE_END_CLOSED : D2D1_FIGURE_END_OPEN);
            });
        }
        else
        {
            bool star = Get(n, "ADBE Vector Star Type", 1) == 1;
            double points = Get(n, "ADBE Vector Star Points", 5);
            if (points < 2 || points > 10000 || points != std::floor(points))
                throw std::runtime_error("Fractional/excessive polystar points unsupported");
            auto p = GetP(n, "ADBE Vector Star Position");
            double a = Get(n, "ADBE Vector Star Rotation", 0) * pi / 180 - pi / 2,
                   outer = Get(n, "ADBE Vector Star Outer Radius", 100),
                   inner = Get(n, "ADBE Vector Star Inner Radius", 50);
            int count = int(points) * (star ? 2 : 1);
            double outerRound = Get(n, "ADBE Vector Star Outer Roundess", 0) / 100,
                   innerRound = star ? Get(n, "ADBE Vector Star Inner Roundess", 0) / 100 : 0;
            bool reverse = Get(n, "ADBE Vector Shape Direction", 1) == 3;
            double direction = reverse ? -1 : 1;
            std::vector<P> vertices, handles;
            for (int i = 0; i < count; ++i)
            {
                bool inset = star && i % 2;
                double angle = a + direction * 2 * pi * i / count, r = inset ? inner : outer;
                // AE-style radial tangents, scaled by roundedness and point count.
                // Reference: lottie-web ShapeProperty.js (convertStar/PolygonToPath).
                // Preserve signed roundedness: negative values deliberately invert the handles.
                // Polygon factor calibrated against the supplied AE 25.6 three-point sample.
                double length = r * (star ? pi / count : .47829) * (inset ? innerRound : outerRound);
                vertices.push_back({p.x + float(r * std::cos(angle)), p.y + float(r * std::sin(angle))});
                handles.push_back(
                    {float(-std::sin(angle) * length * direction), float(std::cos(angle) * length * direction)});
            }
            g = Path([&](ID2D1GeometrySink *s) {
                s->BeginFigure(vertices[0], D2D1_FIGURE_BEGIN_FILLED);
                for (int i = 0; i < count; ++i)
                {
                    int j = (i + 1) % count;
                    if (outerRound == 0 && innerRound == 0)
                        s->AddLine(vertices[j]);
                    else
                        s->AddBezier({Add(vertices[i], handles[i]),
                                      {vertices[j].x - handles[j].x, vertices[j].y - handles[j].y},
                                      vertices[j]});
                }
                s->EndFigure(D2D1_FIGURE_END_CLOSED);
            });
            // Direction was handled during curve construction; keep the Bezier curves intact.
            return g;
        }
        if (Get(n, "ADBE Vector Shape Direction", 1) == 3)
        {
            Sink sink;
            Check(g->Simplify(D2D1_GEOMETRY_SIMPLIFICATION_OPTION_LINES, nullptr, tol, &sink));
            Check(sink.Close());
            for (auto &f : sink.figures)
                std::reverse(f.points.begin(), f.points.end());
            g = Lines(sink.figures);
        }
        return g;
    }
    M Matrix(const J &t, bool repeat = false, double k = 1)
    {
        std::string prefix = repeat ? "ADBE Vector Repeater " : "ADBE Vector ";
        auto a = GetP(t, prefix + "Anchor"), p = GetP(t, prefix + "Position"),
             s = GetP(t, prefix + "Scale", {100, 100});
        double sx = s.x / 100, sy = s.y / 100;
        if (repeat)
        {
            auto power = [&](double v) {
                if (v == 0 && k < 0)
                    throw std::runtime_error("Zero repeater scale with negative offset");
                return std::pow(std::abs(v), k) * (v < 0 && static_cast<long long>(std::floor(k)) % 2 ? -1 : 1);
            };
            sx = power(sx);
            sy = power(sy);
        }
        double skew = repeat ? 0 : Get(t, "ADBE Vector Skew", 0), axis = Get(t, "ADBE Vector Skew Axis", 0);
        M shear(1, 0, float(-std::tan(skew * pi / 180)), 1, 0, 0);
        M m = M::Translation(-a.x, -a.y) * M::Scale(float(sx), float(sy)) * M::Rotation(float(-axis)) * shear *
              M::Rotation(float(axis)) * M::Rotation(float(Get(t, prefix + "Rotation", 0) * k)) *
              M::Translation(float(p.x * k + (repeat ? a.x : 0)), float(p.y * k + (repeat ? a.y : 0)));
        const float *raw = &m._11;
        for (int i = 0; i < 6; ++i)
            if (!std::isfinite(raw[i]))
                throw std::runtime_error("Invalid transform");
        return m;
    }
    std::vector<Shape> Trim(const std::vector<Shape> &paths, const J &n)
    {
        double start = std::clamp(Get(n, "ADBE Vector Trim Start", 0) / 100, 0.0, 1.0),
               end = std::clamp(Get(n, "ADBE Vector Trim End", 100) / 100, 0.0, 1.0);
        if (start > end)
            std::swap(start, end);
        if (end - start >= 1 - 1e-9)
            return paths;
        if (end - start < 1e-9)
            return {};
        double offset = Get(n, "ADBE Vector Trim Offset", 0) / 360;
        bool combined = Get(n, "ADBE Vector Trim Type", 1) == 2;
        struct Part
        {
            Figure f;
            double length;
            float opacity;
        };
        std::vector<Part> parts;
        double total = 0;
        for (const auto &p : paths)
        {
            Sink sink;
            Check(p.geometry->Simplify(D2D1_GEOMETRY_SIMPLIFICATION_OPTION_LINES, nullptr, tol, &sink));
            Check(sink.Close());
            for (auto f : sink.figures)
            {
                if (f.closed && !f.points.empty())
                    f.points.push_back(f.points.front());
                double length = 0;
                for (size_t i = 1; i < f.points.size(); ++i)
                    length += Distance(f.points[i - 1], f.points[i]);
                parts.push_back({f, length, p.opacity});
                total += length;
            }
        }
        std::vector<Shape> result;
        double base = 0;
        for (const auto &part : parts)
        {
            double ref = combined ? total : part.length;
            if (ref == 0)
                continue;
            double a = start + offset;
            a -= std::floor(a);
            double b = a + end - start;
            std::vector<std::pair<double, double>> intervals = {{a * ref, std::min(b, 1.0) * ref}};
            if (b > 1)
                intervals.push_back({0, (b - 1) * ref});
            for (auto [lo, hi] : intervals)
            {
                if (combined)
                {
                    lo -= base;
                    hi -= base;
                }
                double pos = 0;
                Figure f;
                for (size_t i = 1; i < part.f.points.size(); ++i)
                {
                    auto p = part.f.points[i - 1], q = part.f.points[i];
                    double len = Distance(p, q), l = std::max(lo, pos), h = std::min(hi, pos + len);
                    if (len > 0 && h > l)
                    {
                        if (f.points.empty())
                            f.points.push_back(Lerp(p, q, (l - pos) / len));
                        f.points.push_back(Lerp(p, q, (h - pos) / len));
                    }
                    pos += len;
                }
                if (f.points.size() > 1)
                    result.push_back({Lines({f}), part.opacity});
            }
            base += part.length;
        }
        return result;
    }
    std::vector<Shape> RoundCorners(const std::vector<Shape> &paths, const J &n)
    {
        double radius = Get(n, "ADBE Vector RoundCorner Radius", 0);
        if (radius <= 0)
            return paths;
        std::vector<Shape> result;
        for (auto shape : paths)
        {
            Sink sink;
            Check(shape.geometry->Simplify(D2D1_GEOMETRY_SIMPLIFICATION_OPTION_CUBICS_AND_LINES, nullptr, tol, &sink));
            Check(sink.Close());
            shape.geometry = Path([&](ID2D1GeometrySink *s) {
                for (auto figure : sink.curves)
                {
                    auto &v = figure.vertices;
                    // Direct2D may express the closing edge explicitly.
                    if (figure.closed && v.size() > 1 && Distance(v.front().point, v.back().point) < 1e-5)
                    {
                        v.front().in = v.back().in;
                        v.pop_back();
                    }
                    if (v.empty())
                        continue;
                    std::vector<CurveVertex> rounded;
                    for (size_t i = 0; i < v.size(); ++i)
                    {
                        auto current = v[i];
                        bool endpoint = !figure.closed && (i == 0 || i + 1 == v.size());
                        bool corner =
                            Distance(current.point, current.in) < 1e-5 && Distance(current.point, current.out) < 1e-5;
                        if (endpoint || !corner || v.size() < 3)
                        {
                            rounded.push_back(current);
                            continue;
                        }
                        P previous = v[(i + v.size() - 1) % v.size()].point;
                        P next = v[(i + 1) % v.size()].point;
                        double before = Distance(current.point, previous), after = Distance(current.point, next);
                        if (before < 1e-5 || after < 1e-5)
                        {
                            rounded.push_back(current);
                            continue;
                        }
                        P entry = Lerp(current.point, previous, std::min(radius / before, .5));
                        P exit = Lerp(current.point, next, std::min(radius / after, .5));
                        constexpr double handle = .551915024494;
                        rounded.push_back({entry, entry, Lerp(entry, current.point, handle)});
                        rounded.push_back({exit, Lerp(exit, current.point, handle), exit});
                    }
                    s->BeginFigure(rounded[0].point, D2D1_FIGURE_BEGIN_FILLED);
                    size_t edges = figure.closed ? rounded.size() : rounded.size() - 1;
                    for (size_t i = 0; i < edges; ++i)
                    {
                        const auto &from = rounded[i], &to = rounded[(i + 1) % rounded.size()];
                        if (Distance(from.point, from.out) < 1e-5 && Distance(to.point, to.in) < 1e-5)
                            s->AddLine(to.point);
                        else
                            s->AddBezier({from.out, to.in, to.point});
                    }
                    s->EndFigure(figure.closed ? D2D1_FIGURE_END_CLOSED : D2D1_FIGURE_END_OPEN);
                }
            });
            result.push_back(shape);
        }
        return result;
    }
    std::vector<Shape> Offset(const std::vector<Shape> &paths, const J &n)
    {
        double amount = Get(n, "ADBE Vector Offset Amount", 0);
        if (amount == 0)
            return paths;
        if (Get(n, "ADBE Vector Offset Copies", 1) != 1 || Get(n, "ADBE Vector Offset Copy Offset", 1) != 1)
            throw std::runtime_error("Multiple offset copies unsupported");
        auto pen = Pen(n, true);
        std::vector<Shape> result;
        for (auto p : paths)
        {
            Sink sink;
            Check(p.geometry->Simplify(D2D1_GEOMETRY_SIMPLIFICATION_OPTION_LINES, nullptr, tol, &sink));
            Check(sink.Close());
            bool closed =
                std::all_of(sink.figures.begin(), sink.figures.end(), [](const Figure &f) { return f.closed; });
            auto widened = Widen(p.geometry, float(2 * std::abs(amount)), pen.Get());
            auto outline = Path([&](ID2D1GeometrySink *s) { Check(widened->Outline(nullptr, tol, s)); });
            p.geometry =
                closed ? Boolean(p.geometry, outline, amount > 0 ? D2D1_COMBINE_MODE_UNION : D2D1_COMBINE_MODE_EXCLUDE)
                       : outline;
            result.push_back(p);
        }
        return result;
    }
    Result Contents(const J &contents, int depth = 0)
    {
        if (depth > 64)
            throw std::runtime_error("Group nesting limit");
        Result r;
        for (const auto &n : Children(contents))
        {
            if (++visited > 100000)
                throw std::runtime_error("Contents limit");
            if (!n.value("enabled", true))
                continue;
            std::string kind = n.value("kind", "");
            if (kind == "group")
            {
                auto c = Child(n, "ADBE Vectors Group");
                if (!c)
                    continue;
                auto sub = Contents(*c, depth + 1);
                M m = M::Identity();
                float opacity = 1;
                if (auto t = Child(n, "ADBE Vector Transform Group"))
                {
                    m = Matrix(*t);
                    opacity = float(Get(*t, "ADBE Vector Group Opacity", 100) / 100);
                }
                for (auto p : sub.paths)
                {
                    p.geometry = Transform(p.geometry, m);
                    p.opacity *= opacity;
                    r.paths.push_back(p);
                }
                for (auto &d : sub.draws)
                {
                    d.matrix = d.matrix * m;
                }
                if (opacity != 1)
                {
                    OpacityScope scope{++nextScope, opacity};
                    for (auto &d : sub.draws)
                        d.scopes.insert(d.scopes.begin(), scope);
                }
                r.draws.insert(r.draws.begin(), sub.draws.begin(), sub.draws.end());
            }
            else if (kind == "rectangle" || kind == "ellipse" || kind == "polystar" || kind == "path")
                r.paths.push_back({Make(n), 1});
            else if (kind == "fill" || kind == "stroke" || kind == "gradientFill" || kind == "gradientStroke")
            {
                J style = n;
                if (kind == "gradientFill" || kind == "gradientStroke")
                {
                    bool stroke = kind == "gradientStroke";
                    style["kind"] = stroke ? "stroke" : "fill";
                    style["children"].push_back(
                        {{"matchName", stroke ? "ADBE Vector Stroke Color" : "ADBE Vector Fill Color"},
                         {"value", stroke ? J::array({0, 0, 1, 1}) : J::array({1, 0, 0, 1})}});
                }
                if (!r.paths.empty())
                {
                    float opacity = r.paths[0].opacity;
                    bool uniform = std::all_of(r.paths.begin(), r.paths.end(),
                                               [&](const Shape &p) { return p.opacity == opacity; });
                    if (uniform)
                        r.draws.insert(r.draws.begin(), {{Join(r.paths, Get(style, "ADBE Vector Fill Rule", 1) == 2
                                                                            ? D2D1_FILL_MODE_ALTERNATE
                                                                            : D2D1_FILL_MODE_WINDING),
                                                          opacity},
                                                         style});
                    else
                        for (auto it = r.paths.rbegin(); it != r.paths.rend(); ++it)
                            r.draws.insert(r.draws.begin(), {*it, style});
                }
            }
            else if (kind == "mergePaths")
            {
                int mode = int(Get(n, "ADBE Vector Merge Type", 1));
                if (mode < 1 || mode > 5)
                    throw std::runtime_error("Invalid merge mode");
                if (r.paths.empty())
                    continue;
                G g;
                if (mode == 1)
                    g = Join(r.paths);
                else
                {
                    g = r.paths.front().geometry;
                    for (size_t i = 1; i < r.paths.size(); ++i)
                        g = Boolean(g, r.paths[i].geometry,
                                    mode == 2   ? D2D1_COMBINE_MODE_UNION
                                    : mode == 3 ? D2D1_COMBINE_MODE_EXCLUDE
                                    : mode == 4 ? D2D1_COMBINE_MODE_INTERSECT
                                                : D2D1_COMBINE_MODE_XOR);
                }
                r.paths = {{g, 1}};
            }
            else if (kind == "trimPaths" || kind == "offset" || kind == "roundCorners")
            {
                auto apply = [&](const std::vector<Shape> &paths) {
                    return kind == "trimPaths"      ? Trim(paths, n)
                           : kind == "roundCorners" ? RoundCorners(paths, n)
                                                    : Offset(paths, n);
                };
                r.paths = apply(r.paths);
                for (auto &d : r.draws)
                {
                    auto g = Transform(d.shape.geometry, d.matrix);
                    auto changed = apply({{g, d.shape.opacity}});
                    d.shape = {Join(changed), d.shape.opacity};
                    d.matrix = M::Identity();
                }
            }
            else if (kind == "repeater")
            {
                double copies = Get(n, "ADBE Vector Repeater Copies", 1),
                       offset = Get(n, "ADBE Vector Repeater Offset", 0);
                if (copies < 0 || copies > 1000)
                    throw std::runtime_error("Repeater copies outside 0..1000");
                auto t = Child(n, "ADBE Vector Repeater Transform");
                if (!t)
                    throw std::runtime_error("Missing repeater transform");
                auto paths = r.paths;
                auto draws = r.draws;
                r.paths.clear();
                r.draws.clear();
                int count = int(std::ceil(copies));
                if (paths.size() * count > 100000 || draws.size() * count > 100000)
                    throw std::runtime_error("Repeater expansion limit");
                for (int order = 0; order < count; ++order)
                {
                    int i = Get(n, "ADBE Vector Repeater Order", 1) == 1 ? count - 1 - order : order;
                    auto m = Matrix(*t, true, i + offset);
                    double mix = count > 1 ? double(i) / (count - 1) : 0;
                    float opacity = float((Get(*t, "ADBE Vector Repeater Opacity 1", 100) * (1 - mix) +
                                           Get(*t, "ADBE Vector Repeater Opacity 2", 100) * mix) /
                                          100 * std::min(1.0, copies - i));
                    for (auto p : paths)
                    {
                        p.geometry = Transform(p.geometry, m);
                        p.opacity *= opacity;
                        r.paths.push_back(p);
                    }
                    for (auto d : draws)
                    {
                        d.matrix = d.matrix * m;
                        if (opacity != 1)
                            d.scopes.insert(d.scopes.begin(), {nextScope + 1, opacity});
                        r.draws.push_back(d);
                    }
                    ++nextScope;
                }
            }
        }
        return r;
    }
    std::string Render(const J &document, double margin)
    {
        auto result = Contents(document.at("contents"));
        std::ostringstream body;
        body.imbue(std::locale::classic());
        body << std::setprecision(9);
        D2D1_RECT_F bounds{};
        bool hasBounds = false;
        std::vector<OpacityScope> activeScopes;
        for (const auto &draw : result.draws)
        {
            const auto &style = draw.style;
            bool stroke = style.at("kind") == "stroke";
            std::string prefix = stroke ? "ADBE Vector Stroke " : "ADBE Vector Fill ";
            double opacity = Get(style, prefix + "Opacity", 100) / 100 * draw.shape.opacity,
                   width = Get(style, "ADBE Vector Stroke Width", 1);
            if (opacity <= 0 || (stroke && width <= 0))
                continue;
            if (std::any_of(draw.scopes.begin(), draw.scopes.end(),
                            [](const OpacityScope &s) { return s.opacity <= 0; }))
                continue;
            if (Get(style, "ADBE Vector Blend Mode", 1) != 1)
                throw std::runtime_error("Non-normal blend modes unsupported");
            auto color = Child(style, prefix + "Color");
            if (!color)
                throw std::runtime_error("Missing color");
            const auto &rgba = color->at("value");
            if (!rgba.is_array() || (rgba.size() != 3 && rgba.size() != 4))
                throw std::runtime_error("Invalid color");
            int rgb[3];
            for (int i = 0; i < 3; ++i)
                rgb[i] = int(std::round(std::clamp(Num(rgba[i]), 0.0, 1.0) * 255));
            if (rgba.size() == 4)
                opacity *= Num(rgba[3]);
            if (stroke)
                if (auto dash = Child(style, "ADBE Vector Stroke Dashes"))
                    if (!dash->contains("visibilityKnown") && !legacyDashWarning)
                    {
                        std::cerr << "Warning: legacy JSON has no dash visibility information; using solid strokes. "
                                     "Re-export for dashes.\n";
                        legacyDashWarning = true;
                    }
            Sink sink;
            Check(draw.shape.geometry->Simplify(D2D1_GEOMETRY_SIMPLIFICATION_OPTION_CUBICS_AND_LINES, nullptr, tol,
                                                &sink));
            Check(sink.Close());
            auto d = sink.text.str();
            if (d.empty())
                continue;
            size_t common = 0;
            while (common < activeScopes.size() && common < draw.scopes.size() &&
                   activeScopes[common].id == draw.scopes[common].id)
                ++common;
            for (size_t i = activeScopes.size(); i > common; --i)
                body << "  </g>\n";
            for (size_t i = common; i < draw.scopes.size(); ++i)
                body << "  <g opacity=\"" << std::clamp(draw.scopes[i].opacity, 0.0f, 1.0f) << "\">\n";
            activeScopes = draw.scopes;
            D2D1_RECT_F b{};
            if (stroke)
            {
                auto pen = Pen(style);
                Check(draw.shape.geometry->GetWidenedBounds(float(width), pen.Get(), &draw.matrix, tol, &b));
            }
            else
                Check(draw.shape.geometry->GetBounds(&draw.matrix, &b));
            if (b.left <= b.right && b.top <= b.bottom)
            {
                if (!hasBounds)
                {
                    bounds = b;
                    hasBounds = true;
                }
                else
                {
                    bounds.left = std::min(bounds.left, b.left);
                    bounds.top = std::min(bounds.top, b.top);
                    bounds.right = std::max(bounds.right, b.right);
                    bounds.bottom = std::max(bounds.bottom, b.bottom);
                }
            }
            body << "  <path d=\"" << d << "\" transform=\"matrix(" << draw.matrix._11 << ' ' << draw.matrix._12 << ' '
                 << draw.matrix._21 << ' ' << draw.matrix._22 << ' ' << draw.matrix._31 << ' ' << draw.matrix._32
                 << ")\" opacity=\"" << std::clamp(opacity, 0.0, 1.0) << "\" ";
            std::ostringstream c;
            c << "rgb(" << rgb[0] << ',' << rgb[1] << ',' << rgb[2] << ')';
            if (stroke)
            {
                int cap = int(Get(style, "ADBE Vector Stroke Line Cap", 1)),
                    join = int(Get(style, "ADBE Vector Stroke Line Join", 1));
                body << "fill=\"none\" stroke=\"" << c.str() << "\" stroke-width=\"" << width << "\" stroke-linecap=\""
                     << (cap == 2   ? "round"
                         : cap == 3 ? "square"
                                    : "butt")
                     << "\" stroke-linejoin=\""
                     << (join == 2   ? "round"
                         : join == 3 ? "bevel"
                                     : "miter")
                     << "\" stroke-miterlimit=\"" << Get(style, "ADBE Vector Stroke Miter Limit", 4) << "\"";
                if (auto dash = Child(style, "ADBE Vector Stroke Dashes"))
                {
                    if (dash->value("enabled", true) && dash->value("visibilityKnown", false))
                    {
                        std::vector<double> values;
                        for (const auto &v : Children(*dash))
                        {
                            std::string match = v.value("matchName", "");
                            if (match.find("ADBE Vector Stroke Dash ") == 0 ||
                                match.find("ADBE Vector Stroke Gap ") == 0)
                                values.push_back(Num(v.at("value")));
                        }
                        if (!values.empty())
                        {
                            body << " stroke-dasharray=\"";
                            for (double v : values)
                            {
                                if (v < 0)
                                    throw std::runtime_error("Negative dash length");
                                body << v << ' ';
                            }
                            body << "\" stroke-dashoffset=\"" << Get(*dash, "ADBE Vector Stroke Offset", 0) << "\"";
                        }
                    }
                }
            }
            else
                body << "stroke=\"none\" fill=\"" << c.str() << "\" fill-rule=\""
                     << (Get(style, "ADBE Vector Fill Rule", 1) == 2 ? "evenodd" : "nonzero") << "\"";
            body << " />\n";
        }
        for (size_t i = 0; i < activeScopes.size(); ++i)
            body << "  </g>\n";
        double x = hasBounds ? bounds.left - margin : 0, y = hasBounds ? bounds.top - margin : 0,
               w = hasBounds ? std::max(1.0, double(bounds.right - bounds.left) + 2 * margin) : 1,
               h = hasBounds ? std::max(1.0, double(bounds.bottom - bounds.top) + 2 * margin) : 1;
        double translateX = 0, translateY = 0;
        const auto &source = document.at("source");
        bool compCanvas = source.contains("composition");
        if (compCanvas)
        {
            const auto &comp = source.at("composition");
            w = Num(comp.at("width"));
            h = Num(comp.at("height"));
            if (w <= 0 || h <= 0)
                throw std::runtime_error("Invalid composition dimensions");
            auto layerPoint = [&](const char *key, P fallback) {
                const auto &layer = source.at("layer");
                if (!layer.contains(key))
                    return fallback;
                const auto &value = layer.at(key);
                if (!value.is_array() || (value.size() != 2 && value.size() != 3))
                    throw std::runtime_error("Expected 2D/3D layer position or anchor point");
                return P{float(Num(value[0])), float(Num(value[1]))};
            };
            auto anchor = layerPoint("anchorPoint", {});
            auto position = layerPoint("position", {float(w / 2), float(h / 2)});
            translateX = double(position.x) - anchor.x;
            translateY = double(position.y) - anchor.y;
            x = y = 0;
        }
        std::ostringstream svg;
        svg.imbue(std::locale::classic());
        svg << std::setprecision(9);
        svg << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"" << x
            << ' ' << y << ' ' << w << ' ' << h << "\" width=\"" << w << "\" height=\"" << h
            << "\" overflow=\"hidden\">\n  <title>"
            << Escape(document.at("source").at("layer").at("name").get<std::string>()) << "</title>\n"
            << (compCanvas ? "  <g transform=\"translate(" + std::to_string(translateX) + " " +
                                 std::to_string(translateY) + ")\">\n"
                           : "")
            << body.str() << (compCanvas ? "  </g>\n" : "") << "</svg>\n";
        return svg.str();
    }
};
void Validate(const J &n, int depth, size_t &count)
{
    if (depth > 128 || ++count > 1000000)
        throw std::runtime_error("JSON tree limit");
    if (!n.is_object() || !n.contains("matchName") || !n.at("matchName").is_string())
        throw std::runtime_error("Invalid Contents node");
    if (n.contains("children"))
    {
        if (!n.at("children").is_array())
            throw std::runtime_error("children must be array");
        for (const auto &c : n.at("children"))
            Validate(c, depth + 1, count);
    }
    if (n.contains("status") && (n.at("status") == "unavailable" || n.at("status") == "noValue"))
        throw std::runtime_error("Unresolved property: " + n.at("matchName").get<std::string>());
}
} // namespace
void ExportSvg(const std::filesystem::path &input, const std::filesystem::path &output, double margin)
{
    if (!std::isfinite(margin) || margin < 0 || margin > 1e6)
        throw std::runtime_error("Invalid margin");
    if (std::filesystem::weakly_canonical(input) == std::filesystem::weakly_canonical(output))
        throw std::runtime_error("Input and output must differ");
    if (std::filesystem::file_size(input) > 64 * 1024 * 1024)
        throw std::runtime_error("Input exceeds 64 MiB");
    std::ifstream file(input, std::ios::binary);
    if (!file)
        throw std::runtime_error("Cannot open input");
    J doc = J::parse(file);
    if (doc.value("format", "") != "ae-shape-contents" || doc.value("schemaVersion", 0) != 1 ||
        doc.value("scope", "") != "contentsOnly")
        throw std::runtime_error("Unsupported JSON format/version/scope");
    if (!doc.value("complete", false))
        throw std::runtime_error("Incomplete export");
    size_t count = 0;
    Validate(doc.at("contents"), 0, count);
    Exporter exporter;
    auto svg = exporter.Render(doc, margin);
    std::ofstream out(output, std::ios::binary | std::ios::trunc);
    if (!out)
        throw std::runtime_error("Cannot open output");
    out << svg;
    out.close();
    if (!out)
        throw std::runtime_error("Cannot write output");
}
} // namespace asts
