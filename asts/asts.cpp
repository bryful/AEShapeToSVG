#include "SvgExporter.h"
#include "AepGradients.h"
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
int wmain(int argc, wchar_t **argv)
{
    try
    {
        if (argc == 2 && std::wstring(argv[1]) == L"--help")
        {
            std::cout << "export-shapes.exe input.json [output.svg] [--margin pixels]\n";
            std::cout << "export-shapes.exe --inspect-gradients input.aep output.json --time seconds\n";
            return 0;
        }
        if (argc > 1 && std::wstring(argv[1]) == L"--inspect-gradients")
        {
            if (argc != 6 || std::wstring(argv[4]) != L"--time")
                throw std::runtime_error("Usage: --inspect-gradients input.aep output.json --time seconds");
            size_t used = 0; std::wstring value(argv[5]); double time = std::stod(value, &used);
            if (used != value.size()) throw std::runtime_error("Invalid time");
            std::filesystem::path input(argv[2]), output(argv[3]);
            if (std::filesystem::weakly_canonical(input) == std::filesystem::weakly_canonical(output))
                throw std::runtime_error("Input and output must differ");
            auto report = asts::InspectGradients(input, time);
            std::ofstream out(output, std::ios::binary | std::ios::trunc);
            if (!out) throw std::runtime_error("Cannot open inspection output");
            out << report.dump(2) << '\n'; out.close();
            if (!out) throw std::runtime_error("Cannot write inspection output");
            for (const auto &gradient : report.at("gradients"))
                if (gradient.at("status") == "error") return 1;
            return 0;
        }
        if (argc < 2)
        {
            std::cerr << "Usage: export-shapes.exe input.json [output.svg] [--margin pixels]\n";
            return 2;
        }
        std::filesystem::path input(argv[1]), output = input;
        output.replace_extension(L".svg");
        double margin = 2;
        int i = 2;
        if (i < argc && std::wstring(argv[i]) != L"--margin")
            output = argv[i++];
        if (i < argc)
        {
            if (std::wstring(argv[i++]) != L"--margin" || i >= argc)
                throw std::runtime_error("Invalid arguments");
            size_t used = 0;
            std::wstring value(argv[i++]);
            margin = std::stod(value, &used);
            if (used != value.size())
                throw std::runtime_error("Invalid margin");
        }
        if (i != argc)
            throw std::runtime_error("Unexpected argument");
        asts::ExportSvg(input, output, margin);
        std::cout << "SVG saved\n";
        return 0;
    }
    catch (const std::exception &e)
    {
        std::cerr << "export-shapes: " << e.what() << '\n';
        return 1;
    }
}
