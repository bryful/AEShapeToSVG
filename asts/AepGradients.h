#pragma once
#include "third_party/nlohmann/json.hpp"
#include <filesystem>
namespace asts {
nlohmann::json InspectGradients(const std::filesystem::path &input, double timeSeconds);
void ResolveGradients(nlohmann::json &document);
std::string GradientSvg(const nlohmann::json &gradient, const std::string &id);
}
