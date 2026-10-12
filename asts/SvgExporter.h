#pragma once
#include <filesystem>
namespace asts
{
void ExportSvg(const std::filesystem::path &input, const std::filesystem::path &output, double margin = 2);
}
