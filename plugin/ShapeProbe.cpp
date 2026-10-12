#define NOMINMAX
#include <Windows.h>
#include <commdlg.h>
#include "AEConfig.h"
#include "AE_GeneralPlug.h"
#include "AE_EffectCBSuites.h"
#include "SPBasic.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <filesystem>
#include <iomanip>
#include <locale>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>

namespace {
void Check(A_Err e) { if (e) throw std::runtime_error("AE SDK error " + std::to_string(e)); }
template<class T> struct Suite {
    SPBasicSuite* basic; const char* name; A_long version; const T* p = nullptr;
    Suite(SPBasicSuite* b, const char* n, A_long v) : basic(b), name(n), version(v) {
        Check(basic->AcquireSuite(name, version, reinterpret_cast<const void**>(&p)));
    }
    ~Suite() { if (p) basic->ReleaseSuite(name, version); }
    const T* operator->() const { return p; }
    Suite(const Suite&) = delete;
};
struct State { SPBasicSuite* basic; AEGP_PluginID id; AEGP_Command command = 0; };
std::string Quote(const std::string& s) {
    std::ostringstream o; o << '"';
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') o << '\\' << c;
        else if (c < 32) o << "\\u" << std::hex << std::setw(4) << std::setfill('0') << unsigned(c) << std::dec;
        else o << c;
    }
    o << '"'; return o.str();
}
void Number(std::ostream& o, double v) { if (std::isfinite(v)) o << v; else o << "null"; }
struct Stream {
    const AEGP_StreamSuite6* suite; AEGP_StreamRefH h = nullptr;
    ~Stream() { if (h) suite->AEGP_DisposeStream(h); }
};
struct Value {
    const AEGP_StreamSuite6* suite; AEGP_StreamValue2 v{}; bool valid = false;
    ~Value() { if (valid) suite->AEGP_DisposeStreamValue(&v); }
};
struct Collection {
    const AEGP_CollectionSuite2* suite; AEGP_Collection2H h = nullptr;
    ~Collection() { if (h) suite->AEGP_DisposeCollection(h); }
};
void Walk(State& state, const AEGP_DynamicStreamSuite4* dyn, const AEGP_StreamSuite6* streams,
          const PF_HandleSuite1* handles, AEGP_StreamRefH h, const A_Time& time,
          std::ostream& out, int depth, size_t& nodes) {
    if (depth > 64 || ++nodes > 100000) throw std::runtime_error("Contents traversal limit exceeded");
    char match[AEGP_MAX_STREAM_MATCH_NAME_SIZE]{};
    Check(dyn->AEGP_GetMatchName(h, match));
    AEGP_StreamGroupingType grouping{};
    Check(dyn->AEGP_GetStreamGroupingType(h, &grouping));
    out << "{\"matchName\":" << Quote(match) << ",\"groupingType\":" << grouping;
    AEGP_DynStreamFlags flags{};
    auto flagsErr = dyn->AEGP_GetDynamicStreamFlags(h, &flags);
    out << ",\"flagsError\":" << flagsErr << ",\"flags\":" << flags;
    if (grouping == AEGP_StreamGroupingType_NAMED_GROUP || grouping == AEGP_StreamGroupingType_INDEXED_GROUP) {
        A_long count = 0; Check(dyn->AEGP_GetNumStreamsInGroup(h, &count));
        out << ",\"children\":[";
        for (A_long i = 0; i < count; ++i) {
            if (i) out << ',';
            Stream child{streams}; Check(dyn->AEGP_GetNewStreamRefByIndex(state.id, h, i, &child.h));
            Walk(state, dyn, streams, handles, child.h, time, out, depth + 1, nodes);
        }
        out << "]}"; return;
    }
    AEGP_StreamType type{};
    auto typeErr = streams->AEGP_GetStreamType(h, &type);
    out << ",\"typeError\":" << typeErr << ",\"streamType\":" << type;
    A_Boolean varying = FALSE;
    auto varyingErr = streams->AEGP_IsStreamTimevarying(h, &varying);
    out << ",\"timeVaryingError\":" << varyingErr << ",\"timeVarying\":" << (varying ? "true" : "false");
    if (typeErr || type == AEGP_StreamType_NO_DATA) { out << ",\"status\":\"noReadableValue\"}"; return; }
    Value value{streams};
    auto err = streams->AEGP_GetNewStreamValue(state.id, h, AEGP_LTimeMode_CompTime, &time, FALSE, &value.v);
    value.valid = !err;
    out << ",\"valueError\":" << err;
    if (err) { out << ",\"status\":\"readFailed\"}"; return; }
    out << ",\"status\":\"readSucceeded\"";
    switch (type) {
    case AEGP_StreamType_OneD: out << ",\"value\":"; Number(out, value.v.val.one_d); break;
    case AEGP_StreamType_TwoD: case AEGP_StreamType_TwoD_SPATIAL:
        out << ",\"value\":["; Number(out, value.v.val.two_d.x); out << ','; Number(out, value.v.val.two_d.y); out << ']'; break;
    case AEGP_StreamType_ThreeD: case AEGP_StreamType_ThreeD_SPATIAL:
        out << ",\"value\":["; Number(out, value.v.val.three_d.x); out << ','; Number(out, value.v.val.three_d.y); out << ','; Number(out, value.v.val.three_d.z); out << ']'; break;
    case AEGP_StreamType_COLOR:
        out << ",\"value\":["; Number(out, value.v.val.color.redF); out << ','; Number(out, value.v.val.color.greenF); out << ','; Number(out, value.v.val.color.blueF); out << ','; Number(out, value.v.val.color.alphaF); out << ']'; break;
    case AEGP_StreamType_ARB: {
        out << ",\"arbHandlePresent\":" << (value.v.val.arbH ? "true" : "false");
        // Only the gradient stream is inspected. Never interpret embedded pointers or mutate the handle.
        if (value.v.val.arbH && std::string(match) == "ADBE Vector Grad Colors") {
            auto handle = reinterpret_cast<PF_Handle>(value.v.val.arbH);
            auto size = handles->host_get_handle_size(handle);
            out << ",\"arbSize\":" << size;
            auto bytes = static_cast<const unsigned char*>(handles->host_lock_handle(handle));
            if (bytes) {
                // Copy before formatting so exceptions cannot leave the host handle locked.
                unsigned char copy[4096]{};
                size_t n = static_cast<size_t>(std::min<A_HandleSize>(size, sizeof(copy)));
                std::copy_n(bytes, n, copy);
                handles->host_unlock_handle(handle);
                out << ",\"opaqueHexPrefix\":\"" << std::hex << std::setfill('0');
                for (size_t i = 0; i < n; ++i) out << std::setw(2) << unsigned(copy[i]);
                out << std::dec << "\",\"truncated\":" << (size > sizeof(copy) ? "true" : "false");
            } else out << ",\"lockSucceeded\":false";
            out << ",\"decoded\":false";
        }
        break;
    }
    default: out << ",\"valueRepresentation\":\"opaqueNotDecoded\""; break;
    }
    out << '}';
}
void Probe(State& state) {
    Suite<AEGP_ItemSuite9> items(state.basic, kAEGPItemSuite, kAEGPItemSuiteVersion9);
    Suite<AEGP_CompSuite12> comps(state.basic, kAEGPCompSuite, kAEGPCompSuiteVersion12);
    Suite<AEGP_CollectionSuite2> collections(state.basic, kAEGPCollectionSuite, kAEGPCollectionSuiteVersion2);
    Suite<AEGP_DynamicStreamSuite4> dyn(state.basic, kAEGPDynamicStreamSuite, kAEGPDynamicStreamSuiteVersion4);
    Suite<AEGP_StreamSuite6> streams(state.basic, kAEGPStreamSuite, kAEGPStreamSuiteVersion6);
    Suite<PF_HandleSuite1> handles(state.basic, kPFHandleSuite, kPFHandleSuiteVersion1);
    AEGP_ItemH item = nullptr; Check(items->AEGP_GetActiveItem(&item));
    if (!item) throw std::runtime_error("Open a composition and select Shape layers.");
    AEGP_CompH comp = nullptr; Check(comps->AEGP_GetCompFromItem(item, &comp));
    A_Time time{}; Check(items->AEGP_GetItemCurrentTime(item, &time));
    Collection selection{collections.p}; Check(comps->AEGP_GetNewCollectionFromCompSelection(state.id, comp, &selection.h));
    A_u_long count = 0; Check(collections->AEGP_GetCollectionNumItems(selection.h, &count));
    std::ostringstream out; out.imbue(std::locale::classic()); out << std::setprecision(17);
    out << "{\"format\":\"ae-shape-sdk-probe\",\"version\":1,\"time\":{\"value\":" << time.value << ",\"scale\":" << time.scale
        << "},\"postExpression\":true,\"layers\":[";
    std::set<AEGP_LayerH> seen; size_t nodes = 0; size_t exported = 0;
    for (A_u_long i = 0; i < count; ++i) {
        AEGP_CollectionItemV2 entry{}; Check(collections->AEGP_GetCollectionItemByIndex(selection.h, i, &entry));
        if (entry.type != AEGP_CollectionItemType_LAYER || !seen.insert(entry.u.layer.layerH).second) continue;
        Stream root{streams.p}; Check(dyn->AEGP_GetNewStreamRefForLayer(state.id, entry.u.layer.layerH, &root.h));
        Stream contents{streams.p};
        auto error = dyn->AEGP_GetNewStreamRefByMatchname(state.id, root.h, "ADBE Root Vectors Group", &contents.h);
        if (exported++) out << ',';
        out << "{\"selectionIndex\":" << i << ",\"contentsLookupError\":" << error;
        if (!error && contents.h) { out << ",\"contents\":"; Walk(state, dyn.p, streams.p, handles.p, contents.h, time, out, 0, nodes); }
        out << '}';
    }
    out << "]}";
    if (!exported) throw std::runtime_error("Select layer rows in the timeline, not individual properties.");
    wchar_t path[32768] = L"shape-probe.json";
    OPENFILENAMEW dialog{}; dialog.lStructSize = sizeof(dialog); dialog.lpstrFile = path; dialog.nMaxFile = 32768;
    dialog.lpstrFilter = L"JSON (*.json)\0*.json\0\0"; dialog.lpstrDefExt = L"json";
    dialog.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    if (!GetSaveFileNameW(&dialog)) {
        if (CommDlgExtendedError()) throw std::runtime_error("Save dialog failed");
        return;
    }
    std::ofstream file(std::filesystem::path(path), std::ios::binary | std::ios::trunc);
    if (!file) throw std::runtime_error("Cannot open output file");
    file << out.str() << '\n'; file.close();
    if (!file) throw std::runtime_error("Cannot write output file");
    MessageBoxW(nullptr, L"Probe JSON saved. Gradient bytes are opaque and are not decoded color stops.", L"Shape Probe", MB_OK);
}
A_Err Command(AEGP_GlobalRefcon global, AEGP_CommandRefcon, AEGP_Command command, AEGP_HookPriority, A_Boolean, A_Boolean* handled) noexcept {
    auto& state = *reinterpret_cast<State*>(global);
    if (command != state.command) return A_Err_NONE;
    *handled = TRUE;
    try { Probe(state); }
    catch (const std::exception& e) { MessageBoxA(nullptr, e.what(), "Shape Probe failed", MB_OK | MB_ICONERROR); }
    catch (...) { MessageBoxA(nullptr, "Unexpected failure", "Shape Probe failed", MB_OK | MB_ICONERROR); }
    return A_Err_NONE;
}
A_Err Menu(AEGP_GlobalRefcon global, AEGP_UpdateMenuRefcon, AEGP_WindowType) noexcept {
    try {
        auto& s = *reinterpret_cast<State*>(global);
        Suite<AEGP_CommandSuite1> commands(s.basic, kAEGPCommandSuite, kAEGPCommandSuiteVersion1);
        return commands->AEGP_EnableCommand(s.command);
    } catch (...) { return A_Err_GENERIC; }
}
A_Err Death(AEGP_GlobalRefcon global, AEGP_DeathRefcon) noexcept { delete reinterpret_cast<State*>(global); return A_Err_NONE; }
}
extern "C" __declspec(dllexport) A_Err EntryPointFunc(SPBasicSuite* basic, A_long, A_long, AEGP_PluginID id, AEGP_GlobalRefcon* global) noexcept {
    State* state = nullptr;
    try {
        state = new State{basic, id};
        Suite<AEGP_CommandSuite1> commands(basic, kAEGPCommandSuite, kAEGPCommandSuiteVersion1);
        Suite<AEGP_RegisterSuite5> reg(basic, kAEGPRegisterSuite, kAEGPRegisterSuiteVersion5);
        Check(commands->AEGP_GetUniqueCommand(&state->command));
        Check(commands->AEGP_InsertMenuCommand(state->command, "Shape Contents SDK Probe...", AEGP_Menu_FILE, AEGP_MENU_INSERT_AT_BOTTOM));
        *global = reinterpret_cast<AEGP_GlobalRefcon>(state);
        // Once a hook is installed, preserve its state even if later registration fails.
        Check(reg->AEGP_RegisterDeathHook(id, Death, nullptr));
        auto owned = state; state = nullptr;
        Check(reg->AEGP_RegisterCommandHook(id, AEGP_HP_BeforeAE, owned->command, Command, nullptr));
        Check(reg->AEGP_RegisterUpdateMenuHook(id, Menu, nullptr));
        return A_Err_NONE;
    } catch (...) {
        if (state) { delete state; *global = nullptr; }
        return A_Err_GENERIC;
    }
}
