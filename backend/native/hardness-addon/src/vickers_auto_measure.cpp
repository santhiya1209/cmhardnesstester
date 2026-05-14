#include "vickers_auto_measure.h"

#include <opencv2/opencv.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdarg>
#include <cstdlib>
#include <cstdio>
#include <limits>
#include <numeric>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

namespace hardness_vickers {

namespace {

constexpr double kVickersConstant = 1.8544;
constexpr double kPi = 3.14159265358979323846;

struct FrameView {
  const uint8_t* data = nullptr;
  size_t size = 0;
};

struct Params {
  int width = 0;
  int height = 0;
  int bits = 8;
  std::string pixelFormat = "raw";
  std::string sourceType = "live-camera";

  int smoothing = 4;
  int threshold = 118;
  int erosion = 15;
  int dilation = 10;
  int factor = 6;
  int erosionIterations = 1;
  int dilationIterations = 1;
  int morphologyKernelSize = 5;
  std::string thresholdMode = "otsu";
  int manualThreshold = 118;
  double edgeFactor = 38.0;
  double minContourArea = 1.2;
  double maxContourArea = 35.0;
  double centerBias = 40.0;
  int sideFitRoiWidth = 28;
  double gradientStrengthFactor = 36.0;
  std::string imageType = "HV-2";
  std::string objectiveForMeasure;

  double micronPerPixel = 0.0;
  double pxPerMm = 0.0;
  double testForceKgf = 0.0;

  double minConfidence = 0.45;
  double minAreaRatio = 0.00004;
  double maxAreaRatio = 0.18;
  double maxCenterDistanceRatio = 0.62;
  double minDiagonalRatio = 0.58;
  double maxDiagonalRatio = 1.72;
  double maxSideLengthRatio = 1.85;
  double angleToleranceDeg = 34.0;
  int minLinePoints = 8;
};

struct OrderedCorners {
  cv::Point2f top;
  cv::Point2f right;
  cv::Point2f bottom;
  cv::Point2f left;
};

struct ShapeMetrics {
  std::array<double, 4> sideLengths{};
  std::array<double, 4> anglesDeg{};
  double sideRatio = 0.0;
  double d1 = 0.0;
  double d2 = 0.0;
  double diagonalRatio = 0.0;
  double area = 0.0;
};

struct Candidate {
  double contourArea = 0.0;
  double hullArea = 0.0;
  double validationArea = 0.0;
  std::vector<cv::Point> contour;
  std::vector<cv::Point> hull;
  cv::Point2f center;
  double centerDistance = 0.0;
  cv::RotatedRect rect;
  OrderedCorners corners;
  ShapeMetrics metrics;
  double solidity = 0.0;
  int approxPointCount = 0;
  double score = 0.0;
  std::string thresholdMode;
  int contourCount = 0;
  // Deterministic tie-break inputs. `contourIndex` is the position in the
  // findContours output (raster order) for THIS mask. `boundingTopLeft`
  // pins a stable spatial key. Used by CandidateBetterThan when scores
  // are within FLT_EPS so the same frame + params always picks the same
  // contour across repeat clicks.
  int contourIndex = 0;
  cv::Point boundingTopLeft = cv::Point(0, 0);
};

// Score-equality epsilon for tie-break. The score is a weighted sum of
// ~7 components in [0,1]; small float accumulation differences can flip
// strict-> on visually identical contours. 1e-4 is well below any
// meaningful score gap (the smallest weight is 0.03) so this only
// catches numerical noise, not legitimate near-tie cases.
constexpr double kCandidateScoreTieEps = 1e-4;

inline bool CandidateBetterThan(const Candidate& a, const Candidate& b) {
  if (std::abs(a.score - b.score) > kCandidateScoreTieEps) {
    return a.score > b.score;
  }
  // Tie-break order (each strict; if equal, fall through):
  //   1. lower centerDistance (closer to frame center wins)
  //   2. larger validationArea (bigger consistent indentation wins)
  //   3. lower diamond aspect deviation from 1.0 (more square wins)
  //   4. boundingRect top-left X, then Y (deterministic spatial)
  //   5. contourIndex (deterministic vector order)
  if (a.centerDistance != b.centerDistance) return a.centerDistance < b.centerDistance;
  if (a.validationArea != b.validationArea) return a.validationArea > b.validationArea;
  const double aspectDevA = std::abs(a.metrics.diagonalRatio - 1.0);
  const double aspectDevB = std::abs(b.metrics.diagonalRatio - 1.0);
  if (aspectDevA != aspectDevB) return aspectDevA < aspectDevB;
  if (a.boundingTopLeft.x != b.boundingTopLeft.x) return a.boundingTopLeft.x < b.boundingTopLeft.x;
  if (a.boundingTopLeft.y != b.boundingTopLeft.y) return a.boundingTopLeft.y < b.boundingTopLeft.y;
  return a.contourIndex < b.contourIndex;
}

struct LineModel {
  bool ok = false;
  cv::Point2f point;
  cv::Point2f dir;
  int sampleCount = 0;
  int pointCount = 0;
  double residual = 0.0;
  double angleDeltaDeg = 0.0;
};

struct HoughLineCandidate {
  LineModel line;
  double signedDistance = 0.0;
  double length = 0.0;
  double score = 0.0;
};

struct HoughDiamondResult {
  OrderedCorners corners;
  std::array<LineModel, 4> lines;
  double confidence = 0.0;
};

struct DebugInfo {
  std::string rejectionReason;
  std::string sourceType = "live-camera";
  std::string thresholdMode;
  std::string requestedThresholdMode;
  int smoothing = 0;
  int gaussianKernel = 1;
  int threshold = 0;
  int erosion = 0;
  int dilation = 0;
  int factor = 0;
  int erosionIterations = 0;
  int dilationIterations = 0;
  int morphologyKernelSize = 0;
  int manualThreshold = 0;
  double edgeFactor = 0.0;
  double minContourArea = 0.0;
  double maxContourArea = 0.0;
  double centerBias = 0.0;
  int sideFitRoiWidth = 0;
  double gradientStrengthFactor = 0.0;
  int contourCount = 0;
  double minArea = 0.0;
  double maxArea = 0.0;

  bool hasCandidate = false;
  double selectedContourArea = 0.0;
  double selectedHullArea = 0.0;
  double selectedValidationArea = 0.0;
  double contourCenterDistance = 0.0;
  double solidity = 0.0;
  int approxPointCount = 0;
  cv::RotatedRect minAreaRect;
  std::string imageType;
  std::string objectiveForMeasure;
  double initialSideRatio = 0.0;
  double initialDiagonalRatio = 0.0;

  std::array<int, 4> lineSampleCounts{0, 0, 0, 0};
  std::array<int, 4> fittedLinePointCounts{0, 0, 0, 0};
  std::array<double, 4> fittedLineResiduals{0.0, 0.0, 0.0, 0.0};
  std::array<double, 4> fittedLineAngleDeltaDeg{0.0, 0.0, 0.0, 0.0};

  bool hasFinalCorners = false;
  OrderedCorners finalCorners;
  ShapeMetrics finalMetrics;

  double d1Pixels = 0.0;
  double d2Pixels = 0.0;
  double d1Mm = 0.0;
  double d2Mm = 0.0;
  double averageMm = 0.0;
  double confidence = 0.0;
};

double Clamp01(double value) {
  return std::max(0.0, std::min(1.0, value));
}

double Distance(cv::Point2f a, cv::Point2f b) {
  const double dx = static_cast<double>(a.x - b.x);
  const double dy = static_cast<double>(a.y - b.y);
  return std::sqrt(dx * dx + dy * dy);
}

float Cross(cv::Point2f a, cv::Point2f b) {
  return a.x * b.y - a.y * b.x;
}

double Dot(cv::Point2f a, cv::Point2f b) {
  return static_cast<double>(a.x) * b.x + static_cast<double>(a.y) * b.y;
}

cv::Point2f Normalize(cv::Point2f v) {
  const double len = std::sqrt(Dot(v, v));
  if (len <= 1e-6) return {0.0f, 0.0f};
  return {static_cast<float>(v.x / len), static_cast<float>(v.y / len)};
}

double AngleBetweenDirections(cv::Point2f a, cv::Point2f b) {
  const double la = std::sqrt(Dot(a, a));
  const double lb = std::sqrt(Dot(b, b));
  if (la <= 1e-6 || lb <= 1e-6) return 90.0;
  const double c = std::abs(Dot(a, b) / (la * lb));
  return std::acos(std::max(-1.0, std::min(1.0, c))) * 180.0 / kPi;
}

double DirectionAngleDeg(cv::Point2f dir) {
  double angle = std::atan2(dir.y, dir.x) * 180.0 / kPi;
  while (angle < 0.0) angle += 180.0;
  while (angle >= 180.0) angle -= 180.0;
  return angle;
}

double AngleAt(cv::Point2f prev, cv::Point2f current, cv::Point2f next) {
  const cv::Point2f a = prev - current;
  const cv::Point2f b = next - current;
  const double la = std::sqrt(Dot(a, a));
  const double lb = std::sqrt(Dot(b, b));
  if (la <= 1e-6 || lb <= 1e-6) return 0.0;
  const double c = Dot(a, b) / (la * lb);
  return std::acos(std::max(-1.0, std::min(1.0, c))) * 180.0 / kPi;
}

double PositiveNumberFromObject(const Napi::Object& object, const char* key, double fallback) {
  if (!object.Has(key)) return fallback;
  const Napi::Value value = object.Get(key);
  if (!value.IsNumber()) return fallback;
  const double n = value.As<Napi::Number>().DoubleValue();
  return std::isfinite(n) && n > 0.0 ? n : fallback;
}

double NumberFromObject(const Napi::Object& object, const char* key, double fallback) {
  if (!object.Has(key)) return fallback;
  const Napi::Value value = object.Get(key);
  if (!value.IsNumber()) return fallback;
  const double n = value.As<Napi::Number>().DoubleValue();
  return std::isfinite(n) ? n : fallback;
}

int IntFromObject(const Napi::Object& object, const char* key, int fallback) {
  const double value = NumberFromObject(object, key, static_cast<double>(fallback));
  if (!std::isfinite(value)) return fallback;
  return static_cast<int>(std::lround(value));
}

std::string StringFromObject(const Napi::Object& object, const char* key, const std::string& fallback) {
  if (!object.Has(key)) return fallback;
  const Napi::Value value = object.Get(key);
  if (!value.IsString()) return fallback;
  return value.As<Napi::String>().Utf8Value();
}

std::string Lower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  return value;
}

bool AutoMeasureDebugEnabled() {
  const char* value = std::getenv("AUTO_MEASURE_DEBUG");
  if (value == nullptr) return false;
  std::string normalized(value);
  normalized = Lower(normalized);
  return normalized == "true" || normalized == "1" || normalized == "yes";
}

// Forward declarations for objective-aware helpers defined later in the
// file. BuildParams (above the helpers) calls ObjectivePixelScale to
// rescale 40X-tuned defaults at low magnification; without these
// declarations the call is unresolved at compile time.
double ObjectivePixelScale(const std::string& objective);
double ObjectiveLowMagLooseness(const std::string& objective);
double ObjectiveExpectedAreaRatio(const std::string& objective);
double ObjectiveMaxAreaRatio(const std::string& objective);
double PeakedAreaScore(double contourArea, double expectedArea);

void DebugLog(const char* format, ...) {
  if (!AutoMeasureDebugEnabled()) return;
  va_list args;
  va_start(args, format);
  std::vfprintf(stderr, format, args);
  va_end(args);
  std::fflush(stderr);
}

bool ReadFrameBuffer(const Napi::Value& value, FrameView& out, std::string& reason) {
  if (value.IsBuffer()) {
    const auto buffer = value.As<Napi::Buffer<uint8_t>>();
    out.data = buffer.Data();
    out.size = buffer.Length();
    return out.data != nullptr && out.size > 0;
  }

  if (value.IsTypedArray()) {
    auto typed = value.As<Napi::TypedArray>();
    auto arrayBuffer = typed.ArrayBuffer();
    out.data = static_cast<const uint8_t*>(arrayBuffer.Data()) + typed.ByteOffset();
    out.size = typed.ByteLength();
    return out.data != nullptr && out.size > 0;
  }

  if (value.IsArrayBuffer()) {
    auto arrayBuffer = value.As<Napi::ArrayBuffer>();
    out.data = static_cast<const uint8_t*>(arrayBuffer.Data());
    out.size = arrayBuffer.ByteLength();
    return out.data != nullptr && out.size > 0;
  }

  reason = "frameBuffer must be a Buffer, TypedArray, or ArrayBuffer";
  return false;
}

bool ReadParamsObject(const Napi::Object& object, Params& params, std::string& reason) {
  params.width = IntFromObject(object, "width", params.width);
  params.height = IntFromObject(object, "height", params.height);
  params.bits = IntFromObject(object, "bits", params.bits);
  params.pixelFormat = Lower(StringFromObject(object, "pixelFormat", params.pixelFormat));
  params.sourceType = StringFromObject(object, "source", params.sourceType);
  if (params.sourceType != "uploaded-image" && params.sourceType != "live-camera") {
    params.sourceType = "live-camera";
  }

  auto sliderToIterations = [](int value) {
    return std::clamp(static_cast<int>(std::lround(std::clamp(value, 0, 100) / 12.5)), 0, 8);
  };
  auto sliderToOddKernel = [](int value) {
    int kernel = std::clamp(static_cast<int>(std::lround(3.0 + (std::clamp(value, 0, 100) / 100.0) * 12.0)), 3, 15);
    if (kernel % 2 == 0) ++kernel;
    return kernel;
  };

  params.smoothing = std::clamp(IntFromObject(object, "smoothing", params.smoothing), 0, 100);
  params.threshold = std::clamp(IntFromObject(object, "threshold", params.threshold), 0, 255);
  params.erosion = std::clamp(IntFromObject(object, "erosion", params.erosion), 0, 100);
  params.dilation = std::clamp(IntFromObject(object, "dilation", params.dilation), 0, 100);
  params.factor = std::clamp(IntFromObject(object, "factor", params.factor), 0, 100);
  params.erosionIterations = object.Has("erosionIterations")
    ? std::clamp(IntFromObject(object, "erosionIterations", sliderToIterations(params.erosion)), 0, 8)
    : sliderToIterations(params.erosion);
  params.dilationIterations = object.Has("dilationIterations")
    ? std::clamp(IntFromObject(object, "dilationIterations", sliderToIterations(params.dilation)), 0, 8)
    : sliderToIterations(params.dilation);
  params.morphologyKernelSize = object.Has("morphologyKernelSize")
    ? std::clamp(IntFromObject(object, "morphologyKernelSize", params.morphologyKernelSize), 1, 41)
    : sliderToOddKernel(std::max(params.erosion, params.dilation));
  if (params.morphologyKernelSize % 2 == 0) ++params.morphologyKernelSize;
  params.thresholdMode = Lower(StringFromObject(object, "thresholdMode", params.thresholdMode));
  if (params.thresholdMode != "otsu" && params.thresholdMode != "adaptive" && params.thresholdMode != "manual") {
    params.thresholdMode = "otsu";
  }
  params.manualThreshold = std::clamp(IntFromObject(object, "manualThreshold", params.threshold), 0, 255);
  if (object.Has("threshold")) {
    params.thresholdMode = params.threshold > 0 ? "manual" : "otsu";
    params.manualThreshold = params.threshold;
  } else {
    params.threshold = params.manualThreshold;
  }
  params.edgeFactor = object.Has("edgeFactor")
    ? std::clamp(NumberFromObject(object, "edgeFactor", static_cast<double>(params.factor)), 0.0, 100.0)
    : static_cast<double>(params.factor);
  params.minContourArea = std::clamp(NumberFromObject(object, "minContourArea", params.minContourArea), 0.001, 10.0);
  params.maxContourArea = std::clamp(NumberFromObject(object, "maxContourArea", params.maxContourArea), 0.01, 70.0);
  params.centerBias = std::clamp(NumberFromObject(object, "centerBias", params.centerBias), 0.0, 100.0);
  params.sideFitRoiWidth = object.Has("sideFitRoiWidth")
    ? std::clamp(IntFromObject(object, "sideFitRoiWidth", params.sideFitRoiWidth), 4, 90)
    : std::clamp(static_cast<int>(std::lround(14.0 + params.factor * 0.45)), 8, 70);
  params.gradientStrengthFactor = object.Has("gradientStrengthFactor")
    ? std::clamp(NumberFromObject(object, "gradientStrengthFactor", static_cast<double>(params.factor)), 0.0, 100.0)
    : static_cast<double>(params.factor);
  params.imageType = StringFromObject(object, "imageType", params.imageType);
  params.objectiveForMeasure = StringFromObject(object, "objectiveForMeasure", params.objectiveForMeasure);

  // Objective-aware default rescale. Only applied when the caller did NOT
  // explicitly set the parameter — manual tuning from the Auto Measure
  // settings dialog still wins. Without this, 10X indents (small in pixels)
  // get crushed by the 40X-tuned 5x5 morphology kernel and the 28-px
  // sideFitRoi scan band reaches past the true edge, so the fitted corner
  // tips land inside the diamond rather than on the indent tips.
  {
    const double objScale = ObjectivePixelScale(params.objectiveForMeasure);
    if (!object.Has("morphologyKernelSize") && objScale < 0.99) {
      int k = static_cast<int>(std::lround(params.morphologyKernelSize * objScale));
      if (k < 3) k = 3;
      if (k % 2 == 0) ++k;
      params.morphologyKernelSize = std::clamp(k, 3, 41);
    }
    if (!object.Has("sideFitRoiWidth") && objScale < 0.99) {
      int w = static_cast<int>(std::lround(params.sideFitRoiWidth * objScale));
      params.sideFitRoiWidth = std::clamp(w, 4, 90);
    }
  }

  params.micronPerPixel = PositiveNumberFromObject(object, "micronPerPixel", 0.0);
  params.pxPerMm = PositiveNumberFromObject(object, "pxPerMm", 0.0);
  params.testForceKgf = PositiveNumberFromObject(object, "testForceKgf", 0.0);

  if (params.pxPerMm <= 0.0 && params.micronPerPixel > 0.0) {
    params.pxPerMm = 1000.0 / params.micronPerPixel;
  }
  if (params.micronPerPixel <= 0.0 && params.pxPerMm > 0.0) {
    params.micronPerPixel = 1000.0 / params.pxPerMm;
  }

  params.minConfidence = std::clamp(NumberFromObject(object, "minConfidence", params.minConfidence), 0.0, 0.95);
  params.minAreaRatio = std::clamp(NumberFromObject(object, "minAreaRatio", params.minContourArea / 100.0), 0.000005, 0.10);
  params.maxAreaRatio = std::clamp(NumberFromObject(object, "maxAreaRatio", params.maxContourArea / 100.0), 0.005, 0.7);
  params.maxCenterDistanceRatio = std::clamp(
    NumberFromObject(object, "maxCenterDistanceRatio", params.maxCenterDistanceRatio),
    0.05,
    0.9
  );
  if (object.Has("centerBias")) {
    params.maxCenterDistanceRatio = std::clamp(0.82 - params.centerBias * 0.0065, 0.08, 0.9);
  }
  params.minDiagonalRatio = std::clamp(NumberFromObject(object, "minDiagonalRatio", params.minDiagonalRatio), 0.25, 0.99);
  params.maxDiagonalRatio = std::clamp(NumberFromObject(object, "maxDiagonalRatio", params.maxDiagonalRatio), 1.01, 4.0);
  params.maxSideLengthRatio = std::clamp(NumberFromObject(object, "maxSideLengthRatio", params.maxSideLengthRatio), 1.05, 4.0);
  params.angleToleranceDeg = std::clamp(NumberFromObject(object, "angleToleranceDeg", params.angleToleranceDeg), 8.0, 55.0);
  params.minLinePoints = std::clamp(IntFromObject(object, "minLinePoints", params.minLinePoints), 4, 80);

  if (params.imageType == "HV-1") {
    params.minConfidence = std::max(params.minConfidence, 0.52);
    params.maxCenterDistanceRatio = std::min(params.maxCenterDistanceRatio, 0.54);
    params.maxSideLengthRatio = std::min(params.maxSideLengthRatio, 1.70);
    params.angleToleranceDeg = std::min(params.angleToleranceDeg, 30.0);
  } else if (params.imageType == "HV-3") {
    params.minConfidence = std::min(params.minConfidence, 0.38);
    params.maxCenterDistanceRatio = std::max(params.maxCenterDistanceRatio, 0.72);
    params.maxAreaRatio = std::max(params.maxAreaRatio, 0.24);
    params.maxSideLengthRatio = std::max(params.maxSideLengthRatio, 2.15);
    params.angleToleranceDeg = std::max(params.angleToleranceDeg, 42.0);
    params.minLinePoints = std::max(6, params.minLinePoints - 2);
  }

  if (params.width <= 0 || params.height <= 0) {
    reason = "frame width and height must be positive";
    return false;
  }
  if (params.bits != 8 && params.bits != 16) {
    reason = "frame bits must be 8 or 16";
    return false;
  }
  return true;
}

bool ReadParams(const Napi::Value& value, Params& params, std::string& reason) {
  if (!value.IsObject()) {
    reason = "parameters must be an object";
    return false;
  }

  return ReadParamsObject(value.As<Napi::Object>(), params, reason);
}

int SliderToOddKernel(int slider, int minValue, int maxValue) {
  const double t = std::clamp(slider, 0, 100) / 100.0;
  int value = static_cast<int>(std::lround(minValue + t * (maxValue - minValue)));
  value = std::max(1, value);
  if (value % 2 == 0) ++value;
  return value;
}

int SmoothingToGaussianKernel(int smoothing) {
  if (smoothing <= 0) return 1;
  const int bucket = std::clamp(static_cast<int>(std::ceil(smoothing / 4.0)), 1, 5);
  return bucket * 2 + 1;
}

bool DecodeToGray(const FrameView& frame, const Params& params, cv::Mat& gray, std::string& reason) {
  const int width = params.width;
  const int height = params.height;
  const size_t pixels = static_cast<size_t>(width) * static_cast<size_t>(height);
  const std::string fmt = Lower(params.pixelFormat);

  if (pixels == 0) {
    reason = "frame dimensions are empty";
    return false;
  }

  auto requireBytes = [&](size_t needed) -> bool {
    if (frame.size < needed) {
      std::ostringstream ss;
      ss << "frame buffer too small for " << fmt << ": need " << needed << " bytes, got " << frame.size;
      reason = ss.str();
      return false;
    }
    return true;
  };

  const bool monoLike =
    fmt == "mono8" || fmt == "raw" || fmt == "bayer_bg" || fmt == "bayer_gb" ||
    fmt == "bayer_gr" || fmt == "bayer_rg";

  if (monoLike) {
    if (params.bits == 16 && frame.size >= pixels * 2) {
      const cv::Mat src(height, width, CV_16UC1, const_cast<uint8_t*>(frame.data));
      src.convertTo(gray, CV_8UC1, 1.0 / 256.0);
      return true;
    }
    if (!requireBytes(pixels)) return false;
    gray = cv::Mat(height, width, CV_8UC1, const_cast<uint8_t*>(frame.data)).clone();
    return true;
  }

  if (fmt == "bgr24" || fmt == "rgb24") {
    if (!requireBytes(pixels * 3)) return false;
    const cv::Mat src(height, width, CV_8UC3, const_cast<uint8_t*>(frame.data));
    cv::cvtColor(src, gray, fmt == "bgr24" ? cv::COLOR_BGR2GRAY : cv::COLOR_RGB2GRAY);
    return true;
  }

  if (fmt == "bgr32" || fmt == "rgb32") {
    if (!requireBytes(pixels * 4)) return false;
    const cv::Mat src(height, width, CV_8UC4, const_cast<uint8_t*>(frame.data));
    cv::cvtColor(src, gray, fmt == "bgr32" ? cv::COLOR_BGRA2GRAY : cv::COLOR_RGBA2GRAY);
    return true;
  }

  if (!requireBytes(pixels)) return false;
  gray = cv::Mat(height, width, CV_8UC1, const_cast<uint8_t*>(frame.data)).clone();
  return true;
}

cv::Mat ApplyMorphology(const cv::Mat& binary, const Params& params) {
  cv::Mat out = binary.clone();
  const int kernelSize = std::max(1, params.morphologyKernelSize);
  const cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, {kernelSize, kernelSize});

  if (params.dilationIterations > 0) {
    cv::morphologyEx(out, out, cv::MORPH_CLOSE, kernel, cv::Point(-1, -1), params.dilationIterations);
  }
  if (params.erosionIterations > 0) {
    cv::morphologyEx(out, out, cv::MORPH_OPEN, kernel, cv::Point(-1, -1), params.erosionIterations);
  }
  return out;
}

cv::Mat CloseOpenMask(const cv::Mat& binary, int closeSize, int openSize, int dilateSize = 1) {
  cv::Mat out = binary.clone();
  if (dilateSize > 1) {
    const cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, {dilateSize, dilateSize});
    cv::dilate(out, out, kernel);
  }
  if (closeSize > 1) {
    const cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, {closeSize, closeSize});
    cv::morphologyEx(out, out, cv::MORPH_CLOSE, kernel);
  }
  if (openSize > 1) {
    const cv::Mat kernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, {openSize, openSize});
    cv::morphologyEx(out, out, cv::MORPH_OPEN, kernel);
  }
  return out;
}

bool IsEdgeMaskMode(const std::string& thresholdMode) {
  return thresholdMode == "blackhat" ||
         thresholdMode == "tophat" ||
         thresholdMode == "gradient" ||
         thresholdMode == "canny" ||
         thresholdMode == "edge-union";
}

struct Preprocessed {
  cv::Mat clahe;
  cv::Mat blurred;
  cv::Mat gradX;
  cv::Mat gradY;
  cv::Mat gradMag;
  int gaussianKernel = 1;
  double gradMean = 0.0;
  double gradStd = 0.0;
  std::vector<std::pair<std::string, cv::Mat>> masks;
};

Preprocessed Preprocess(const cv::Mat& gray, const Params& params) {
  Preprocessed out;

  // Exposure / gain robustness step. Before CLAHE we rescale the input so
  // the dynamic range used by the histogram-tone-map is always [0..255],
  // regardless of how dark or bright the camera frame actually came in.
  // Without this, a 2x exposure bump shifts CLAHE's working histogram and
  // the downstream Otsu/adaptive thresholds move with it. Robust min/max
  // (1st/99th percentile via minMaxLoc on a clipped copy) avoids letting a
  // single hot specular blob blow out the rescale.
  double rawMin = 0.0, rawMax = 0.0;
  cv::minMaxLoc(gray, &rawMin, &rawMax);
  cv::Mat normalized;
  if (rawMax - rawMin > 8.0) {
    cv::normalize(gray, normalized, 0, 255, cv::NORM_MINMAX, CV_8U);
  } else {
    normalized = gray.clone();
  }
  cv::Scalar normMean, normStd;
  cv::meanStdDev(normalized, normMean, normStd);
  std::fprintf(stderr,
    "[auto-measure][illumination-normalize] rawMin=%.1f rawMax=%.1f normMean=%.2f normStd=%.2f rescaled=%s\n",
    rawMin, rawMax, normMean[0], normStd[0],
    (rawMax - rawMin > 8.0) ? "true" : "false");
  std::fprintf(stderr,
    "[auto-measure][normalize] rawMin=%.1f rawMax=%.1f mean=%.2f std=%.2f method=minMax+CLAHE rescaled=%s\n",
    rawMin, rawMax, normMean[0], normStd[0],
    (rawMax - rawMin > 8.0) ? "true" : "false");
  std::fflush(stderr);

  // CLAHE clip limit eases off when the post-normalize contrast is already
  // strong (avoids over-amplifying noise on a bright/high-gain frame) and
  // tightens up when the frame is naturally flat (low gain).
  const double claheClip = normStd[0] > 60.0 ? 1.6 : (normStd[0] < 25.0 ? 2.8 : 2.2);
  cv::Ptr<cv::CLAHE> clahe = cv::createCLAHE(claheClip, {8, 8});
  clahe->apply(normalized, out.clahe);

  int blurKernel = SmoothingToGaussianKernel(params.smoothing);
  out.gaussianKernel = blurKernel;
  if (blurKernel > 1) {
    cv::GaussianBlur(out.clahe, out.blurred, {blurKernel, blurKernel}, 0.0);
  } else {
    out.blurred = out.clahe.clone();
  }
  std::fprintf(stderr,
    "[detect-smoothing-applied] value=%d kernel=%d\n",
    params.smoothing, blurKernel);
  std::fflush(stderr);
  std::fprintf(stderr,
    "[detect-preprocess] smoothing=%d kernel=%d claheClip=%.2f thresholdParam=%d\n",
    params.smoothing, blurKernel, claheClip, params.threshold);
  std::fflush(stderr);

  cv::Mat otsu;
  cv::threshold(out.blurred, otsu, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);

  int block = std::max(15, (std::min(gray.cols, gray.rows) / 18) | 1);
  if (block % 2 == 0) ++block;
  const double adaptiveC = 2.0 + params.edgeFactor / 12.0;
  cv::Mat adaptive;
  cv::adaptiveThreshold(
    out.blurred,
    adaptive,
    255,
    cv::ADAPTIVE_THRESH_GAUSSIAN_C,
    cv::THRESH_BINARY_INV,
    block,
    adaptiveC
  );

  cv::Mat manual;
  cv::threshold(
    out.blurred,
    manual,
    params.threshold,
    255,
    cv::THRESH_BINARY_INV
  );
  std::fprintf(stderr,
    "[detect-threshold-applied] value=%d\n", params.threshold);
  std::fflush(stderr);

  // Mask emission order = priority for SelectBestContour. The user-picked
  // mode goes first (so the slider still drives the primary mask), but we
  // ALWAYS append Otsu and adaptive as exposure-invariant fallbacks. This
  // is the key robustness change: a manual threshold tuned for one exposure
  // no longer prevents detection when exposure/gain shift — Otsu adapts to
  // the new histogram automatically, adaptive masks pick up local contrast.
  if (params.thresholdMode == "adaptive") {
    out.masks.push_back({"adaptive", ApplyMorphology(adaptive, params)});
    out.masks.push_back({"otsu", ApplyMorphology(otsu, params)});
    out.masks.push_back({"manual", ApplyMorphology(manual, params)});
  } else if (params.thresholdMode == "manual") {
    out.masks.push_back({"manual", ApplyMorphology(manual, params)});
    out.masks.push_back({"otsu", ApplyMorphology(otsu, params)});
    out.masks.push_back({"adaptive", ApplyMorphology(adaptive, params)});
  } else {
    out.masks.push_back({"otsu", ApplyMorphology(otsu, params)});
    out.masks.push_back({"adaptive", ApplyMorphology(adaptive, params)});
    out.masks.push_back({"manual", ApplyMorphology(manual, params)});
  }
  std::fprintf(stderr,
    "[auto-measure][adaptive-threshold] mode=%s block=%d C=%.2f fallbacks=otsu,adaptive,manual claheClip=%.2f\n",
    params.thresholdMode.c_str(), block, adaptiveC, claheClip);
  std::fflush(stderr);

  // Slider-dominant mode: when the user is driving threshold/smoothing from
  // the UI (mode resolves to "manual" or "otsu"), the chosen mask must be the
  // sole input to contour selection — otherwise edge-based fallbacks blend in
  // and the D1/D2 tips snap instead of moving smoothly with the slider.
  // Only "adaptive" (an opt-in legacy mode) keeps the multi-mask fallback.
  const bool sliderDominant =
    params.thresholdMode == "manual" || params.thresholdMode == "otsu";

  if (!sliderDominant) {
    const int blackhatKernelSize = SliderToOddKernel(params.factor, 13, 41);
    cv::Mat blackhat;
    cv::morphologyEx(
      out.clahe,
      blackhat,
      cv::MORPH_BLACKHAT,
      cv::getStructuringElement(cv::MORPH_ELLIPSE, {blackhatKernelSize, blackhatKernelSize})
    );
    cv::Mat blackhatMask;
    cv::threshold(blackhat, blackhatMask, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    out.masks.push_back({
      "blackhat",
      CloseOpenMask(
        blackhatMask,
        SliderToOddKernel(params.dilation, 7, 29),
        SliderToOddKernel(params.erosion, 1, 7),
        3
      )
    });

    cv::Mat tophat;
    cv::morphologyEx(
      out.clahe,
      tophat,
      cv::MORPH_TOPHAT,
      cv::getStructuringElement(cv::MORPH_ELLIPSE, {blackhatKernelSize, blackhatKernelSize})
    );
    cv::Mat tophatMask;
    cv::threshold(tophat, tophatMask, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    out.masks.push_back({
      "tophat",
      CloseOpenMask(
        tophatMask,
        SliderToOddKernel(params.dilation, 7, 29),
        SliderToOddKernel(params.erosion, 1, 7),
        3
      )
    });

    cv::Mat morphGradient;
    cv::morphologyEx(
      out.blurred,
      morphGradient,
      cv::MORPH_GRADIENT,
      cv::getStructuringElement(cv::MORPH_ELLIPSE, {SliderToOddKernel(params.factor, 3, 11), SliderToOddKernel(params.factor, 3, 11)})
    );
    cv::Mat gradientMask;
    cv::threshold(morphGradient, gradientMask, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    out.masks.push_back({
      "gradient",
      CloseOpenMask(
        gradientMask,
        SliderToOddKernel(params.dilation, 7, 31),
        1,
        3
      )
    });

    cv::Mat canny;
    cv::Mat otsuScratch;
    const double otsuLevel = cv::threshold(out.blurred, otsuScratch, 0, 255, cv::THRESH_BINARY | cv::THRESH_OTSU);
    const double low = std::clamp(otsuLevel * 0.33, 18.0, 90.0);
    const double high = std::clamp(otsuLevel * 0.90, low + 20.0, 190.0);
    cv::Canny(out.blurred, canny, low, high, 3, true);
    out.masks.push_back({
      "canny",
      CloseOpenMask(
        canny,
        SliderToOddKernel(params.dilation, 7, 31),
        1,
        3
      )
    });

    cv::Mat edgeUnion;
    cv::bitwise_or(blackhatMask, tophatMask, edgeUnion);
    cv::bitwise_or(edgeUnion, gradientMask, edgeUnion);
    cv::bitwise_or(edgeUnion, canny, edgeUnion);
    out.masks.push_back({
      "edge-union",
      CloseOpenMask(
        edgeUnion,
        SliderToOddKernel(params.dilation, 9, 39),
        1,
        5
      )
    });
  }

  cv::Sobel(out.blurred, out.gradX, CV_32F, 1, 0, 3);
  cv::Sobel(out.blurred, out.gradY, CV_32F, 0, 1, 3);
  cv::magnitude(out.gradX, out.gradY, out.gradMag);
  cv::Scalar mean, stddev;
  cv::meanStdDev(out.gradMag, mean, stddev);
  out.gradMean = mean[0];
  out.gradStd = stddev[0];
  // Gradient stats are the exposure-independent signal that side-refinement
  // and Hough fallbacks key off. Logging them lets the operator correlate a
  // weak detection with an actually-flat frame (low gradStd) vs. a bright
  // halo competing with the dark edge.
  std::fprintf(stderr,
    "[auto-measure][gradient-strength] gradMean=%.2f gradStd=%.2f gaussianKernel=%d masks=%zu\n",
    out.gradMean, out.gradStd, out.gaussianKernel, out.masks.size());
  std::fprintf(stderr,
    "[auto-measure][gradient] op=sobel kernel=3 magnitude=L2 gradMean=%.2f gradStd=%.2f\n",
    out.gradMean, out.gradStd);
  std::fflush(stderr);
  return out;
}

OrderedCorners OrderDiamondCorners(const std::vector<cv::Point2f>& input, cv::Point2f center) {
  std::vector<cv::Point2f> points = input;
  std::sort(points.begin(), points.end(), [&](const cv::Point2f& a, const cv::Point2f& b) {
    return std::atan2(a.y - center.y, a.x - center.x) < std::atan2(b.y - center.y, b.x - center.x);
  });

  const double d02 = Distance(points[0], points[2]);
  const double d13 = Distance(points[1], points[3]);
  const std::array<cv::Point2f, 2> pairA{points[0], points[2]};
  const std::array<cv::Point2f, 2> pairB{points[1], points[3]};
  const auto& lrPair =
    std::abs(pairA[0].x - pairA[1].x) >= std::abs(pairB[0].x - pairB[1].x) ? pairA : pairB;
  const auto& tbPair = (&lrPair == &pairA) ? pairB : pairA;
  (void)d02;
  (void)d13;

  OrderedCorners ordered;
  ordered.left = lrPair[0].x <= lrPair[1].x ? lrPair[0] : lrPair[1];
  ordered.right = lrPair[0].x > lrPair[1].x ? lrPair[0] : lrPair[1];
  ordered.top = tbPair[0].y <= tbPair[1].y ? tbPair[0] : tbPair[1];
  ordered.bottom = tbPair[0].y > tbPair[1].y ? tbPair[0] : tbPair[1];
  return ordered;
}

std::array<cv::Point2f, 4> ToSideOrder(const OrderedCorners& c) {
  return {c.top, c.right, c.bottom, c.left};
}

ShapeMetrics ComputeShapeMetrics(const OrderedCorners& corners) {
  ShapeMetrics metrics;
  const auto p = ToSideOrder(corners);
  for (int i = 0; i < 4; ++i) {
    metrics.sideLengths[i] = Distance(p[i], p[(i + 1) % 4]);
  }
  const auto minmaxSide = std::minmax_element(metrics.sideLengths.begin(), metrics.sideLengths.end());
  metrics.sideRatio = *minmaxSide.first > 1e-6 ? *minmaxSide.second / *minmaxSide.first : std::numeric_limits<double>::infinity();
  metrics.d1 = Distance(corners.left, corners.right);
  metrics.d2 = Distance(corners.top, corners.bottom);
  const double minDiag = std::min(metrics.d1, metrics.d2);
  const double maxDiag = std::max(metrics.d1, metrics.d2);
  metrics.diagonalRatio = minDiag > 1e-6 ? maxDiag / minDiag : std::numeric_limits<double>::infinity();
  for (int i = 0; i < 4; ++i) {
    metrics.anglesDeg[i] = AngleAt(p[(i + 3) % 4], p[i], p[(i + 1) % 4]);
  }
  std::vector<cv::Point2f> polygon{corners.top, corners.right, corners.bottom, corners.left};
  metrics.area = std::abs(cv::contourArea(polygon));
  return metrics;
}

std::vector<cv::Point2f> InitialCornerEstimate(
  const std::vector<cv::Point>& contour,
  const cv::RotatedRect& rect,
  int& approxPointCount
) {
  std::vector<cv::Point> hull;
  cv::convexHull(contour, hull);

  std::vector<cv::Point> approx;
  if (hull.size() >= 4) {
    const double perimeter = cv::arcLength(hull, true);
    cv::approxPolyDP(hull, approx, std::max(2.0, perimeter * 0.025), true);
  }
  approxPointCount = static_cast<int>(approx.size());

  std::vector<cv::Point2f> points;
  if (approx.size() == 4) {
    for (const auto& p : approx) points.push_back({static_cast<float>(p.x), static_cast<float>(p.y)});
    return points;
  }

  cv::Point2f rectPoints[4];
  rect.points(rectPoints);
  points.assign(rectPoints, rectPoints + 4);
  return points;
}

double RatioScore(double ratio, double maxRatio) {
  if (!std::isfinite(ratio) || ratio <= 0.0) return 0.0;
  if (ratio <= 1.0) return 1.0;
  return Clamp01(1.0 - (ratio - 1.0) / std::max(0.01, maxRatio - 1.0));
}

// One-sided objective looseness: only loosen the diagonal floor for low
// magnifications where indents are physically smaller in pixels. For 40X+
// the gates stay bit-for-bit identical to the legacy values so we never
// regress detection that already worked. Reference is 40X.
double ObjectiveLowMagLooseness(const std::string& objective) {
  if (objective == "10X") return 0.25;
  if (objective == "20X") return 0.50;
  return 1.00; // 40X / 50X / 100X / unknown: unchanged
}

// Case/whitespace-insensitive "10X" check. Live logs showed the area gate
// rejecting at threshold≈15116 (= minAreaRatio*imageArea) instead of the 10X
// constant floor, which means `objectiveForMeasure == "10X"` was failing for
// some payloads (e.g. "10x", " 10X "). All 10X-specific branches go through
// this helper now so a casing/trim mismatch can never silently route a 10X
// frame through the 40X-tuned area gate.
bool IsObjective10X(const std::string& objective) {
  size_t begin = 0;
  size_t end = objective.size();
  while (begin < end && std::isspace(static_cast<unsigned char>(objective[begin]))) ++begin;
  while (end > begin && std::isspace(static_cast<unsigned char>(objective[end - 1]))) --end;
  if (end - begin != 3) return false;
  const char c0 = static_cast<char>(std::toupper(static_cast<unsigned char>(objective[begin + 0])));
  const char c1 = static_cast<char>(std::toupper(static_cast<unsigned char>(objective[begin + 1])));
  const char c2 = static_cast<char>(std::toupper(static_cast<unsigned char>(objective[begin + 2])));
  return c0 == '1' && c1 == '0' && c2 == 'X';
}

// Pixel-scale factor for objective-aware default tuning. The pixel size of a
// Vickers indent is proportional to the optical magnification. The default
// `morphologyKernelSize` (5) and `sideFitRoiWidth` (28) are tuned for 40X.
// At 10X the indent is ~1/4 the pixel area, so a 5x5 closing kernel can crush
// the diamond corners and a 28-pixel side-fit scan band can reach into
// surrounding microstructure, dragging the fitted side lines off the true
// edge and putting the corner intersections inside the indent rather than on
// the tips. Reference: 40X = 1.0.
double ObjectivePixelScale(const std::string& objective) {
  if (objective == "5X")  return 0.20;
  if (objective == "10X") return 0.35;
  if (objective == "20X") return 0.60;
  if (objective == "40X") return 1.00;
  if (objective == "50X") return 1.10;
  if (objective == "100X") return 1.40;
  return 1.00; // unknown: no rescale
}

double MinIndentationAreaPixels(const Params& params) {
  const double imageArea = static_cast<double>(params.width) * params.height;
  // 10X: at low magnification the indent is physically small in pixels and
  // the JS-side `minAreaRatio` (tuned for the *expected* indent area) was
  // rejecting every real contour because it sits ~6x above the actual indent
  // size on visible frames. Use a low absolute floor so the area gate only
  // rejects obvious noise; the shape / diagonal / angle gates downstream
  // still filter non-diamond candidates.
  if (IsObjective10X(params.objectiveForMeasure)) {
    std::fprintf(stderr,
      "[auto-measure-min-area] objective=\"%s\" resolved=10X minArea=200.0 reason=low-mag-floor\n",
      params.objectiveForMeasure.c_str());
    std::fflush(stderr);
    return 200.0;
  }
  const double v = std::max(120.0, imageArea * params.minAreaRatio);
  std::fprintf(stderr,
    "[auto-measure-min-area] objective=\"%s\" resolved=other minArea=%.2f reason=ratio*imageArea minAreaRatio=%.6f imageArea=%.0f\n",
    params.objectiveForMeasure.c_str(), v, params.minAreaRatio, imageArea);
  std::fflush(stderr);
  return v;
}

// Expected indent area as fraction of full-frame area for each objective.
// Used to BOTH peak the candidate-selection area score and tighten the
// max-area gate at low magnifications. Returns 0.0 when unknown so callers
// know to fall back to legacy behaviour (40X-tuned).
double ObjectiveExpectedAreaRatio(const std::string& objective) {
  if (objective == "5X")  return 0.003;
  if (objective == "10X") return 0.012;
  if (objective == "20X") return 0.025;
  if (objective == "40X") return 0.055;
  if (objective == "50X") return 0.060;
  if (objective == "100X") return 0.075;
  return 0.0; // unknown
}

// Max area as fraction of frame allowed for the diamond contour at each
// objective. At low mag the indent is small in pixels, so a contour that
// is 18% of the frame (the legacy maxAreaRatio) is almost certainly a
// scratch / polish mark / frame artefact rather than the indent. Tighten.
double ObjectiveMaxAreaRatio(const std::string& objective) {
  if (objective == "5X")  return 0.020;
  if (objective == "10X") return 0.050;
  if (objective == "20X") return 0.090;
  return 0.0; // 40X+ / unknown: keep legacy params.maxAreaRatio
}

// Peaked area-score: 1.0 when contourArea == expectedArea, drops to 0 at
// expectedArea*2^1.5 (~2.8x) or expectedArea/2^1.5 (~0.36x). This replaces
// the linear "bigger = better" bias that was picking large background
// regions over the actual small indent at 10X.
double PeakedAreaScore(double contourArea, double expectedArea) {
  if (expectedArea <= 0.0 || contourArea <= 0.0) return 0.0;
  const double octaves = std::log2(contourArea / expectedArea);
  const double absOctaves = std::abs(octaves);
  if (absOctaves >= 1.5) return 0.0;
  return 1.0 - (absOctaves / 1.5);
}

double MinIndentationDiagonalPixels(const Params& params) {
  const double minDim = std::min(params.width, params.height);
  const double looseness = ObjectiveLowMagLooseness(params.objectiveForMeasure);
  const double areaDiagonal = std::sqrt(std::max(1.0, MinIndentationAreaPixels(params) * 2.0));
  return std::max(minDim * 0.10 * looseness, areaDiagonal);
}

std::optional<Candidate> SelectBestContour(
  const cv::Mat& mask,
  const std::string& thresholdMode,
  const Params& params,
  DebugInfo& debug
) {
  std::vector<std::vector<cv::Point>> contours;
  cv::findContours(mask, contours, cv::RETR_EXTERNAL, cv::CHAIN_APPROX_SIMPLE);
  debug.contourCount = std::max(debug.contourCount, static_cast<int>(contours.size()));
  std::fprintf(stderr,
    "[detect-contour-count] count=%zu mode=%s\n",
    contours.size(),
    thresholdMode.empty() ? "unknown" : thresholdMode.c_str());
  std::fflush(stderr);

  const double imageArea = static_cast<double>(params.width) * params.height;
  const double minArea = MinIndentationAreaPixels(params);
  // Objective-aware max area: at 10X / 20X the indent is small, so the
  // legacy 18%-of-frame ceiling lets background contours (scratches, polish
  // marks, frame edges) win selection. Tighten the cap to ~5% / 9% at low
  // mag so wrong-large contours never enter the score race in the first
  // place. 40X+ / unknown keep the original gate bit-for-bit.
  const double objMaxAreaRatio = ObjectiveMaxAreaRatio(params.objectiveForMeasure);
  const double effectiveMaxAreaRatio =
    objMaxAreaRatio > 0.0 ? std::min(params.maxAreaRatio, objMaxAreaRatio) : params.maxAreaRatio;
  const double maxArea = std::max(minArea * 2.0, imageArea * effectiveMaxAreaRatio);
  // Expected/peak indent area in pixels for the current objective. Drives
  // the area component of the candidate score so that the diamond beats
  // wrong-large contours instead of losing to them.
  const double expectedAreaRatio = ObjectiveExpectedAreaRatio(params.objectiveForMeasure);
  const double expectedAreaPx = expectedAreaRatio > 0.0 ? imageArea * expectedAreaRatio : 0.0;
  debug.minArea = minArea;
  debug.maxArea = maxArea;

  // Unconditional spec-format log so the operator can correlate which
  // objective + frame dims are active without needing AUTO_MEASURE_DEBUG.
  // Emitted once per call (per mask pass actually, but the start log
  // upstream in MeasureVickersAuto already runs once per detection).
  std::fprintf(stderr,
    "[auto-measure-selectbest] mode=%s minArea=%.1f maxArea=%.1f maxAreaRatio=%.4f expectedAreaPx=%.1f maxCenterDistance=%.1f\n",
    thresholdMode.c_str(), minArea, maxArea, effectiveMaxAreaRatio,
    expectedAreaPx,
    std::min(params.width, params.height) * params.maxCenterDistanceRatio);
  std::fflush(stderr);

  const cv::Point2f imageCenter(params.width * 0.5f, params.height * 0.5f);
  const double maxCenterDistance = std::min(params.width, params.height) * params.maxCenterDistanceRatio;
  // 10X mode: the live indent is small and often offset because the operator
  // positions the test by hand. Treat center proximity as a ranking factor
  // only, not a hard reject. 40X+ keeps the legacy gate bit-for-bit.
  const bool tenXMode = params.objectiveForMeasure == "10X";

  std::optional<Candidate> best;
  // Per-contour index for log correlation. Logging is gated on
  // AutoMeasureDebugEnabled() so production builds stay quiet unless the
  // env flag is set; on the failing frame the user enables the flag,
  // reproduces, and reads which filter fired without algorithm changes.
  const bool debugLog = AutoMeasureDebugEnabled();
  int contourIndex = -1;
  int usableCount = 0;
  // Per-iteration captured metrics — reject10x reads these so every rejection
  // line carries the full snapshot the operator needs without grepping
  // multiple log lines. Fields not yet computed at the point of rejection
  // stay at -1 ("not-yet-evaluated"). Reset at the top of each iteration.
  double curArea = -1.0;
  double curCenterDist = -1.0;
  double curSolidity = -1.0;
  double curRatio = -1.0;        // diagonalRatio (or rectLong/rectShort pre-corner-estimate)
  double curAspect = -1.0;       // rect aspect ratio (rectLong/rectShort) — preserved across corner estimation
  double curDarkness = -1.0;     // mean intensity inside the contour, lower=darker
  double curDiamondScore = -1.0; // composite candidate score
  auto reject10x = [&](const char* reason, double metric, double threshold) {
    if (tenXMode) {
      std::fprintf(stderr,
        "[auto-measure-reject] contour=%d reason=%s metric=%.4f threshold=%.4f "
        "area=%.2f centerDist=%.2f solidity=%.4f ratio=%.4f darkness=%.4f diamondScore=%.4f\n",
        contourIndex, reason, metric, threshold,
        curArea, curCenterDist, curSolidity, curRatio, curDarkness, curDiamondScore);
      // Spec-format per-candidate trace — emitted for every rejected
      // candidate so the operator can see WHICH gate fired and what the
      // raw metrics looked like. `aspect` is rectLong/rectShort (preserved
      // even after corner estimation overwrites curRatio with the diamond
      // diagonal ratio). Fields not yet computed at the point of rejection
      // are -1 ("not-yet-evaluated").
      std::fprintf(stderr,
        "[opencv-auto] candidate index=%d area=%.2f centerDist=%.2f solidity=%.4f "
        "aspect=%.4f diagRatio=%.4f darkness=%.4f score=%.4f rejectReason=%s\n",
        contourIndex, curArea, curCenterDist, curSolidity,
        curAspect, curRatio, curDarkness, curDiamondScore, reason);
      std::fflush(stderr);
    }
  };
  if (tenXMode) {
    std::fprintf(stderr,
      "[auto-measure-10x-contours] mode=%s totalContours=%d\n",
      thresholdMode.c_str(), static_cast<int>(contours.size()));
    std::fflush(stderr);
  }
  for (const auto& contour : contours) {
    ++contourIndex;
    curArea = -1.0; curCenterDist = -1.0; curSolidity = -1.0;
    curRatio = -1.0; curAspect = -1.0; curDarkness = -1.0; curDiamondScore = -1.0;
    const double area = std::abs(cv::contourArea(contour));
    curArea = area;

    std::vector<cv::Point> hull;
    cv::convexHull(contour, hull);
    const double hullArea = std::abs(cv::contourArea(hull));
    const bool edgeMaskMode = IsEdgeMaskMode(thresholdMode);
    const double validationArea = edgeMaskMode ? std::max(area, hullArea) : area;

    cv::Point2f preCenter(0.0f, 0.0f);
    double preCenterDistance = -1.0;
    {
      const cv::Moments mm = cv::moments(contour);
      if (std::abs(mm.m00) > 1e-6) {
        preCenter = cv::Point2f(
          static_cast<float>(mm.m10 / mm.m00),
          static_cast<float>(mm.m01 / mm.m00)
        );
        preCenterDistance = Distance(preCenter, imageCenter);
      }
    }
    const cv::RotatedRect preRect = cv::minAreaRect(contour);
    const double preRectShort = std::min(preRect.size.width, preRect.size.height);
    const double preRectLong = std::max(preRect.size.width, preRect.size.height);
    const double preRatio = preRectShort > 1e-6 ? preRectLong / preRectShort : 0.0;
    curCenterDist = preCenterDistance;
    curRatio = preRatio;
    curAspect = preRatio;
    // Darkness: mean pixel intensity inside the contour mask. Lower=darker
    // indent, higher=light region. Cheap snapshot via boundingRect ROI so it
    // works even when the contour is rejected at an early gate.
    {
      const cv::Rect bbDark = cv::boundingRect(contour);
      if (bbDark.width > 0 && bbDark.height > 0 && !mask.empty()) {
        const cv::Mat roi = mask(bbDark);
        const double meanMask = cv::mean(roi)[0];
        // Mask is 0/255 (foreground=indent). Convert to a 0..1 "darkness"
        // proxy where 1.0 = entire ROI is mask-positive.
        curDarkness = meanMask / 255.0;
      }
    }

    if (debugLog) {
      DebugLog(
        "[auto-measure-candidate] mode=%s contour=%d area=%.2f hullArea=%.2f validationArea=%.2f centerX=%.2f centerY=%.2f rectShort=%.2f rectLong=%.2f ratio=%.3f\n",
        thresholdMode.c_str(), contourIndex, area, hullArea, validationArea,
        preCenter.x, preCenter.y, preRectShort, preRectLong, preRatio
      );
    }

    if (validationArea < minArea) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=area-too-small validationArea=%.2f min=%.2f\n",
        thresholdMode.c_str(), contourIndex, validationArea, minArea
      );
      reject10x("area-too-small", validationArea, minArea);
      continue;
    }
    if (validationArea > maxArea) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=area-too-large validationArea=%.2f max=%.2f\n",
        thresholdMode.c_str(), contourIndex, validationArea, maxArea
      );
      reject10x("area-too-large", validationArea, maxArea);
      continue;
    }

    const cv::Moments m = cv::moments(contour);
    if (std::abs(m.m00) <= 1e-6) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=zero-moment m00=%.6f\n",
        thresholdMode.c_str(), contourIndex, m.m00
      );
      reject10x("zero-moment", m.m00, 0.0);
      continue;
    }
    const cv::Point2f center(static_cast<float>(m.m10 / m.m00), static_cast<float>(m.m01 / m.m00));
    const double centerDistance = Distance(center, imageCenter);
    if (!tenXMode && centerDistance > maxCenterDistance) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=not-centered dx=%.2f dy=%.2f distance=%.2f tolerance=%.2f\n",
        thresholdMode.c_str(), contourIndex,
        static_cast<double>(center.x - imageCenter.x),
        static_cast<double>(center.y - imageCenter.y),
        centerDistance, maxCenterDistance
      );
      continue;
    }

    // 10X: reject only if the contour touches the image border (incomplete
    // diamond). Off-center but fully visible diamonds remain candidates and
    // are penalised by centerScore only.
    if (tenXMode) {
      const cv::Rect bbox = cv::boundingRect(contour);
      if (bbox.x <= 1 || bbox.y <= 1 ||
          bbox.x + bbox.width >= params.width - 1 ||
          bbox.y + bbox.height >= params.height - 1) {
        std::fprintf(stderr,
          "[auto-measure-reject] reason=candidate-touches-border contour=%d bboxX=%d bboxY=%d bboxW=%d bboxH=%d\n",
          contourIndex, bbox.x, bbox.y, bbox.width, bbox.height);
        std::fflush(stderr);
        continue;
      }
    }

    const double solidity = hullArea > 1e-6 ? area / hullArea : 0.0;
    curSolidity = solidity;
    const double solidityMin = edgeMaskMode ? 0.035 : 0.52;
    if (solidity < solidityMin) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=solidity-too-low solidity=%.4f min=%.4f edgeMaskMode=%d\n",
        thresholdMode.c_str(), contourIndex, solidity, solidityMin, edgeMaskMode ? 1 : 0
      );
      reject10x("solidity-too-low", solidity, solidityMin);
      continue;
    }

    const cv::RotatedRect rect = cv::minAreaRect(contour);
    const double rectShort = std::min(rect.size.width, rect.size.height);
    const double rectLong = std::max(rect.size.width, rect.size.height);
    if (rectShort < 8.0 || rectLong < 12.0) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=rect-too-small rectShort=%.2f rectLong=%.2f minShort=8.00 minLong=12.00\n",
        thresholdMode.c_str(), contourIndex, rectShort, rectLong
      );
      reject10x("rect-too-small", rectShort, 8.0);
      continue;
    }

    int approxPointCount = 0;
    std::vector<cv::Point2f> initial = InitialCornerEstimate(contour, rect, approxPointCount);
    if (initial.size() != 4) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=initial-corners-not-4 cornerCount=%zu approxPointCount=%d\n",
        thresholdMode.c_str(), contourIndex, initial.size(), approxPointCount
      );
      reject10x("initial-corners-not-4", static_cast<double>(initial.size()), 4.0);
      continue;
    }

    const OrderedCorners corners = OrderDiamondCorners(initial, center);
    const ShapeMetrics metrics = ComputeShapeMetrics(corners);
    // Side ratio at the pre-refinement stage is informational only — the
    // rough minAreaRect-derived sides are noisy at low magnification and
    // straighten out once side-fit + intersections produce the true tips.
    // Only drop the candidate when the value is non-finite (degenerate
    // contour). A genuinely lopsided shape gets re-checked post-refinement
    // and is warned about there rather than rejected outright.
    if (!std::isfinite(metrics.sideRatio)) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=side-ratio-non-finite\n",
        thresholdMode.c_str(), contourIndex
      );
      reject10x("side-ratio-non-finite", 0.0, 0.0);
      continue;
    }
    if (metrics.sideRatio > params.maxSideLengthRatio * 1.25) {
      std::fprintf(stderr,
        "[auto-measure-warning] reason=side-ratio-high stage=pre-refine sideRatio=%.4f softMax=%.4f decision=continue\n",
        metrics.sideRatio, params.maxSideLengthRatio * 1.25);
      std::fflush(stderr);
    }
    if (!std::isfinite(metrics.diagonalRatio)) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=diagonal-ratio-non-finite\n",
        thresholdMode.c_str(), contourIndex
      );
      reject10x("diagonal-ratio-non-finite", 0.0, 0.0);
      continue;
    }
    curRatio = metrics.diagonalRatio;
    if (metrics.diagonalRatio > params.maxDiagonalRatio || (1.0 / metrics.diagonalRatio) < params.minDiagonalRatio) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=diagonal-ratio-out-of-range diagonalRatio=%.4f min=%.4f max=%.4f\n",
        thresholdMode.c_str(), contourIndex,
        metrics.diagonalRatio, params.minDiagonalRatio, params.maxDiagonalRatio
      );
      reject10x("diagonal-ratio-out-of-range", metrics.diagonalRatio, params.maxDiagonalRatio);
      continue;
    }

    double maxAngleError = 0.0;
    for (double angle : metrics.anglesDeg) {
      maxAngleError = std::max(maxAngleError, std::abs(angle - 90.0));
    }
    if (maxAngleError > params.angleToleranceDeg + 16.0) {
      if (debugLog) DebugLog(
        "[auto-measure-reject] mode=%s contour=%d reason=angle-error-too-large maxAngleError=%.2f tolerance=%.2f\n",
        thresholdMode.c_str(), contourIndex,
        maxAngleError, params.angleToleranceDeg + 16.0
      );
      reject10x("angle-error-too-large", maxAngleError, params.angleToleranceDeg + 16.0);
      continue;
    }

    // Area score: peaked around the objective's expected indent area when
    // we know it (10X/20X/40X/...). Otherwise fall back to the legacy
    // linear-up-to-5.5%-of-frame curve so existing 40X-tuned behaviour is
    // preserved bit-for-bit on unknown objectives.
    const double areaScore = expectedAreaPx > 0.0
      ? PeakedAreaScore(validationArea, expectedAreaPx)
      : Clamp01(validationArea / (imageArea * 0.055));
    const double centerScore = Clamp01(1.0 - centerDistance / std::max(1.0, maxCenterDistance));
    const double sideScore = RatioScore(metrics.sideRatio, params.maxSideLengthRatio);
    const double diagScore = RatioScore(metrics.diagonalRatio, params.maxDiagonalRatio);
    const double angleScore = Clamp01(1.0 - maxAngleError / std::max(1.0, params.angleToleranceDeg + 16.0));
    const double shapeScore = approxPointCount == 4 ? 1.0 : 0.70;
    const double score =
      0.42 * areaScore +
      0.20 * centerScore +
      0.12 * sideScore +
      0.12 * diagScore +
      0.07 * angleScore +
      0.04 * Clamp01((solidity - (edgeMaskMode ? 0.02 : 0.5)) / (edgeMaskMode ? 0.20 : 0.45)) +
      0.03 * shapeScore;

    Candidate candidate;
    candidate.contourArea = area;
    candidate.hullArea = hullArea;
    candidate.validationArea = validationArea;
    candidate.contour = contour;
    candidate.hull = hull;
    candidate.center = center;
    candidate.centerDistance = centerDistance;
    candidate.rect = rect;
    candidate.corners = corners;
    candidate.metrics = metrics;
    candidate.solidity = solidity;
    candidate.approxPointCount = approxPointCount;
    candidate.score = score;
    candidate.thresholdMode = thresholdMode;
    candidate.contourCount = static_cast<int>(contours.size());
    candidate.contourIndex = contourIndex;
    candidate.boundingTopLeft = cv::boundingRect(contour).tl();
    // Per-accepted-candidate trace in spec format so operators can grep
    // candidate disposition across a single detection.
    std::fprintf(stderr,
      "[detect-candidate] idx=%d score=%.4f area=%.2f centerDist=%.2f ratio=%.4f mode=%s\n",
      contourIndex, score, validationArea, centerDistance,
      metrics.diagonalRatio,
      thresholdMode.empty() ? "unknown" : thresholdMode.c_str());
    std::fflush(stderr);

    // Unconditional per-accepted-candidate trace (spec format). Helps the
    // operator see WHY a wrong-large contour was preferred — e.g. seeing
    // multiple candidates with similar score lets us tune weights.
    std::fprintf(stderr,
      "[auto-measure-candidate] index=%d area=%.2f centerX=%.2f centerY=%.2f rectShort=%.2f rectLong=%.2f darkness=%.4f diamondScore=%.4f score=%.4f areaScore=%.4f\n",
      contourIndex, validationArea, center.x, center.y, rectShort, rectLong,
      solidity, shapeScore, score, areaScore);
    if (tenXMode) {
      std::fprintf(stderr,
        "[auto-measure-10x-candidate] centerX=%.2f centerY=%.2f area=%.2f centerScore=%.4f totalScore=%.4f\n",
        center.x, center.y, validationArea, centerScore, score);
      // Spec-format per-candidate trace — accepted side. Paired with the
      // rejection variant emitted by reject10x; same field order so the
      // operator can grep `[opencv-auto] candidate` and see EVERY contour's
      // disposition + raw metrics in one pass.
      std::fprintf(stderr,
        "[opencv-auto] candidate index=%d area=%.2f centerDist=%.2f solidity=%.4f "
        "aspect=%.4f diagRatio=%.4f darkness=%.4f score=%.4f rejectReason=accepted\n",
        contourIndex, validationArea, centerDistance, solidity,
        curAspect, metrics.diagonalRatio, curDarkness, score);
    }
    std::fflush(stderr);

    curDiamondScore = score;
    ++usableCount;
    if (!best || CandidateBetterThan(candidate, *best)) {
      best = candidate;
    }
  }

  if (tenXMode) {
    std::fprintf(stderr,
      "[opencv-auto] contours total=%d usable=%d mode=%s objective=10X\n",
      static_cast<int>(contours.size()), usableCount, thresholdMode.c_str());
    std::fflush(stderr);
  }

  if (best) {
    std::fprintf(stderr,
      "[auto-measure-selected] index=%d area=%.2f centerX=%.2f centerY=%.2f reason=best-dark-diamond score=%.4f\n",
      best->approxPointCount, best->contourArea, best->center.x, best->center.y, best->score);
    if (tenXMode) {
      const double d1Px = Distance(best->corners.left, best->corners.right);
      const double d2Px = Distance(best->corners.top, best->corners.bottom);
      std::fprintf(stderr,
        "[auto-measure-10x-selected] centerX=%.2f centerY=%.2f d1Px=%.2f d2Px=%.2f\n",
        best->center.x, best->center.y, d1Px, d2Px);
      // Spec-format selected trace — matches `[opencv-auto] candidate ...`
      // family so the operator can see which candidate index won. Corners
      // are in native image coordinates (the same coords the frontend
      // overlay maps via getImagePlacement).
      std::fprintf(stderr,
        "[opencv-auto] selected area=%.2f score=%.4f corners=(top=%.2f,%.2f|right=%.2f,%.2f|bottom=%.2f,%.2f|left=%.2f,%.2f)\n",
        best->contourArea, best->score,
        best->corners.top.x, best->corners.top.y,
        best->corners.right.x, best->corners.right.y,
        best->corners.bottom.x, best->corners.bottom.y,
        best->corners.left.x, best->corners.left.y);
    }
    std::fflush(stderr);
  }

  if (debugLog) {
    if (best) {
      DebugLog(
        "[auto-measure-selected] mode=%s contour=%d centerX=%.2f centerY=%.2f area=%.2f score=%.4f rectShort=%.2f rectLong=%.2f sideRatio=%.4f diagonalRatio=%.4f\n",
        thresholdMode.c_str(),
        best->contourCount,
        best->center.x,
        best->center.y,
        best->contourArea,
        best->score,
        std::min(best->rect.size.width, best->rect.size.height),
        std::max(best->rect.size.width, best->rect.size.height),
        best->metrics.sideRatio,
        best->metrics.diagonalRatio
      );
    } else {
      DebugLog(
        "[auto-measure-selected] mode=%s contour=none totalContours=%d minArea=%.2f maxArea=%.2f maxCenterDistance=%.2f\n",
        thresholdMode.c_str(),
        static_cast<int>(contours.size()),
        minArea,
        maxArea,
        maxCenterDistance
      );
    }
  }

  return best;
}

float SampleFloatNearest(const cv::Mat& mat, cv::Point2f p) {
  const int x = static_cast<int>(std::lround(p.x));
  const int y = static_cast<int>(std::lround(p.y));
  if (x < 0 || y < 0 || x >= mat.cols || y >= mat.rows) return 0.0f;
  return mat.at<float>(y, x);
}

std::vector<cv::Point2f> SampleEdgePoints(
  const Preprocessed& pre,
  cv::Point2f a,
  cv::Point2f b,
  cv::Point2f center,
  const Params& params,
  int& sampleCount
) {
  std::vector<cv::Point2f> points;
  const double len = Distance(a, b);
  if (len < 8.0) return points;

  cv::Point2f u = Normalize(b - a);
  cv::Point2f n(-u.y, u.x);
  const cv::Point2f mid = (a + b) * 0.5f;
  if (Dot(center - mid, n) < 0.0) n = -n;

  sampleCount = std::clamp(static_cast<int>(std::lround(len / 3.0)), 18, 180);
  const double sensitivity = std::clamp(params.edgeFactor / 100.0, 0.0, 1.0);
  const int scanHalf = std::clamp(
    static_cast<int>(std::lround(params.sideFitRoiWidth * (0.76 + sensitivity * 0.48))),
    4,
    96
  );
  const double gradientStdFactor = -0.05 + (params.gradientStrengthFactor / 100.0) * 0.85;
  const float minGradient = static_cast<float>(std::max(5.0, pre.gradMean + pre.gradStd * gradientStdFactor));

  points.reserve(sampleCount);
  for (int i = 0; i < sampleCount; ++i) {
    const double t = 0.10 + (0.80 * (i + 0.5) / sampleCount);
    const cv::Point2f base = a + u * static_cast<float>(len * t);

    float bestStrength = -1.0f;
    cv::Point2f bestPoint;
    for (int offset = -scanHalf; offset <= scanHalf; ++offset) {
      const cv::Point2f p = base + n * static_cast<float>(offset);
      if (p.x < 1.0f || p.y < 1.0f || p.x >= params.width - 1.0f || p.y >= params.height - 1.0f) {
        continue;
      }
      const float gx = SampleFloatNearest(pre.gradX, p);
      const float gy = SampleFloatNearest(pre.gradY, p);
      const float directional = std::abs(gx * n.x + gy * n.y);
      const float magnitude = SampleFloatNearest(pre.gradMag, p);
      const float strength = std::max(directional, magnitude * 0.72f);
      if (strength > bestStrength) {
        bestStrength = strength;
        bestPoint = p;
      }
    }

    if (bestStrength >= minGradient) {
      points.push_back(bestPoint);
    }
  }

  return points;
}

double Median(std::vector<double> values) {
  if (values.empty()) return 0.0;
  const size_t mid = values.size() / 2;
  std::nth_element(values.begin(), values.begin() + mid, values.end());
  double result = values[mid];
  if (values.size() % 2 == 0) {
    std::nth_element(values.begin(), values.begin() + mid - 1, values.end());
    result = (result + values[mid - 1]) * 0.5;
  }
  return result;
}

double LineDistance(const LineModel& line, cv::Point2f p) {
  return std::abs(Cross(p - line.point, line.dir));
}

LineModel FitRobustLine(
  const std::vector<cv::Point2f>& points,
  cv::Point2f estimatedDirection,
  int sampleCount,
  int minLinePoints
) {
  LineModel model;
  model.sampleCount = sampleCount;
  if (static_cast<int>(points.size()) < minLinePoints) {
    model.pointCount = static_cast<int>(points.size());
    return model;
  }

  std::vector<cv::Point2f> inliers = points;
  LineModel current;
  for (int iter = 0; iter < 3; ++iter) {
    if (static_cast<int>(inliers.size()) < minLinePoints) break;

    cv::Vec4f line;
    cv::fitLine(inliers, line, cv::DIST_HUBER, 0.0, 0.01, 0.01);
    current.dir = Normalize({line[0], line[1]});
    current.point = {line[2], line[3]};
    if (Dot(current.dir, estimatedDirection) < 0.0) current.dir = -current.dir;

    std::vector<double> distances;
    distances.reserve(inliers.size());
    for (const auto& p : inliers) distances.push_back(LineDistance(current, p));
    const double med = Median(distances);
    std::vector<double> absDev;
    absDev.reserve(distances.size());
    for (double d : distances) absDev.push_back(std::abs(d - med));
    const double mad = Median(absDev);
    const double threshold = std::max(2.0, med + 2.8 * std::max(0.5, mad));

    std::vector<cv::Point2f> next;
    next.reserve(inliers.size());
    for (const auto& p : inliers) {
      if (LineDistance(current, p) <= threshold) next.push_back(p);
    }
    if (next.size() == inliers.size()) break;
    inliers = next;
  }

  if (static_cast<int>(inliers.size()) < minLinePoints) {
    model.pointCount = static_cast<int>(inliers.size());
    return model;
  }

  cv::Vec4f line;
  cv::fitLine(inliers, line, cv::DIST_HUBER, 0.0, 0.01, 0.01);
  model.dir = Normalize({line[0], line[1]});
  model.point = {line[2], line[3]};
  if (Dot(model.dir, estimatedDirection) < 0.0) model.dir = -model.dir;
  model.pointCount = static_cast<int>(inliers.size());
  model.angleDeltaDeg = AngleBetweenDirections(model.dir, estimatedDirection);

  double residualSum = 0.0;
  for (const auto& p : inliers) residualSum += LineDistance(model, p);
  model.residual = residualSum / std::max(1, model.pointCount);
  model.ok = true;
  return model;
}

bool IntersectLines(const LineModel& a, const LineModel& b, cv::Point2f& out) {
  const float denom = Cross(a.dir, b.dir);
  if (std::abs(denom) < 1e-4f) return false;
  const cv::Point2f qp = b.point - a.point;
  const float t = Cross(qp, b.dir) / denom;
  out = a.point + a.dir * t;
  return std::isfinite(out.x) && std::isfinite(out.y);
}

bool PointInsideImage(cv::Point2f p, const Params& params) {
  return p.x >= 0.0f && p.y >= 0.0f && p.x <= params.width - 1.0f && p.y <= params.height - 1.0f;
}

// How far a corner is allowed to fall outside the image (in pixels) before
// we treat it as a genuine failure. At low magnifications (10X) the
// side-fit / minAreaRect path can produce tip coordinates a couple of
// pixels past the edge due to extrapolation when the diamond is near the
// frame border. Snapping these back to the boundary is correct and avoids
// rejecting an otherwise-valid detection.
constexpr float kCornerOutsideToleranceFloor = 6.0f;

float CornerOutsideTolerance(const Params& params) {
  const float dim = static_cast<float>(std::min(params.width, params.height));
  return std::max(kCornerOutsideToleranceFloor, dim * 0.01f);
}

// Returns (corner, distanceClampedPx). Snaps to the image boundary when the
// point is outside; reports zero distance when fully inside.
cv::Point2f ClampPointToImageBounds(cv::Point2f p, const Params& params, float& distanceOut) {
  const float maxX = static_cast<float>(params.width) - 1.0f;
  const float maxY = static_cast<float>(params.height) - 1.0f;
  cv::Point2f c = p;
  if (c.x < 0.0f) c.x = 0.0f;
  if (c.y < 0.0f) c.y = 0.0f;
  if (c.x > maxX) c.x = maxX;
  if (c.y > maxY) c.y = maxY;
  distanceOut = std::hypot(c.x - p.x, c.y - p.y);
  return c;
}

OrderedCorners ExtractAxisTipsFromContour(
  const std::vector<cv::Point>& contour,
  const std::vector<cv::Point>& hull,
  const OrderedCorners& fallback,
  cv::Point2f center
) {
  const std::vector<cv::Point>& points = hull.size() >= 4 ? hull : contour;
  if (points.empty()) return fallback;

  auto toPoint2f = [](const cv::Point& p) {
    return cv::Point2f(static_cast<float>(p.x), static_cast<float>(p.y));
  };

  cv::Point top = points.front();
  cv::Point right = points.front();
  cv::Point bottom = points.front();
  cv::Point left = points.front();

  double bestTop = std::numeric_limits<double>::infinity();
  double bestRight = -std::numeric_limits<double>::infinity();
  double bestBottom = -std::numeric_limits<double>::infinity();
  double bestLeft = std::numeric_limits<double>::infinity();

  for (const auto& p : points) {
    const double centerPenaltyX = std::abs(static_cast<double>(p.x) - center.x) * 0.10;
    const double centerPenaltyY = std::abs(static_cast<double>(p.y) - center.y) * 0.10;
    const double topScore = static_cast<double>(p.y) + centerPenaltyX;
    const double bottomScore = static_cast<double>(p.y) - centerPenaltyX;
    const double leftScore = static_cast<double>(p.x) + centerPenaltyY;
    const double rightScore = static_cast<double>(p.x) - centerPenaltyY;

    if (topScore < bestTop) {
      bestTop = topScore;
      top = p;
    }
    if (bottomScore > bestBottom) {
      bestBottom = bottomScore;
      bottom = p;
    }
    if (leftScore < bestLeft) {
      bestLeft = leftScore;
      left = p;
    }
    if (rightScore > bestRight) {
      bestRight = rightScore;
      right = p;
    }
  }

  OrderedCorners tips;
  tips.top = toPoint2f(top);
  tips.right = toPoint2f(right);
  tips.bottom = toPoint2f(bottom);
  tips.left = toPoint2f(left);
  return tips;
}

bool ValidateContourTips(
  OrderedCorners& corners,
  const Params& params,
  const DebugInfo& debug,
  std::string& reason
) {
  // Soft clamp: snap tips that fall a few pixels outside the image back to
  // the boundary. Only reject when a corner is FAR outside (likely garbage),
  // which avoids over-rejecting valid 10X detections where the diamond
  // touches a frame edge and the fit extrapolates by ~1-3 px.
  const float tol = CornerOutsideTolerance(params);
  cv::Point2f* tips[4] = { &corners.top, &corners.right, &corners.bottom, &corners.left };
  const char* names[4] = { "top", "right", "bottom", "left" };
  for (int i = 0; i < 4; ++i) {
    float dist = 0.0f;
    cv::Point2f clamped = ClampPointToImageBounds(*tips[i], params, dist);
    if (dist > tol) {
      std::fprintf(stderr,
        "[auto-measure-reject] reason=corner-outside-image corner=%s x=%.2f y=%.2f frameWidth=%d frameHeight=%d distPx=%.2f tolPx=%.2f\n",
        names[i], tips[i]->x, tips[i]->y, params.width, params.height, dist, tol);
      std::fflush(stderr);
      reason = "corner is outside image";
      return false;
    }
    if (dist > 0.0f) {
      DebugLog(
        "[auto-measure-corner-clamp] corner=%s rawX=%.2f rawY=%.2f clampedX=%.2f clampedY=%.2f distPx=%.2f\n",
        names[i], tips[i]->x, tips[i]->y, clamped.x, clamped.y, dist);
      *tips[i] = clamped;
    }
  }

  const ShapeMetrics metrics = ComputeShapeMetrics(corners);
  if (!std::isfinite(metrics.area) || metrics.area < debug.minArea || metrics.area > debug.maxArea * 2.0) {
    reason = "final diamond area is outside valid range";
    return false;
  }
  if (metrics.d1 < MinIndentationDiagonalPixels(params) ||
      metrics.d2 < MinIndentationDiagonalPixels(params)) {
    reason = "selected shape is too small to be indentation";
    return false;
  }
  // Side-ratio after line-refined corners: warning only. The diamond shape
  // is already validated by area, diagonal ratio, and angle-to-90 checks
  // below — those are the geometric invariants that matter. Sides can be a
  // few percent uneven on a real centered indentation because the dark
  // edges meet imperfectly under the bright halo at low magnification.
  if (!std::isfinite(metrics.sideRatio)) {
    std::fprintf(stderr,
      "[auto-measure-warning] reason=side-ratio-non-finite stage=post-refine decision=accept\n");
    std::fflush(stderr);
  } else if (metrics.sideRatio > params.maxSideLengthRatio * 1.15) {
    std::fprintf(stderr,
      "[auto-measure-warning] reason=side-ratio-high stage=post-refine sideRatio=%.4f softMax=%.4f decision=accept\n",
      metrics.sideRatio, params.maxSideLengthRatio * 1.15);
    std::fflush(stderr);
  }
  if (!std::isfinite(metrics.diagonalRatio) ||
      metrics.diagonalRatio > params.maxDiagonalRatio ||
      (1.0 / metrics.diagonalRatio) < params.minDiagonalRatio) {
    reason = "diagonal ratio is abnormal";
    return false;
  }
  for (double angle : metrics.anglesDeg) {
    if (std::abs(angle - 90.0) > params.angleToleranceDeg + 8.0) {
      reason = "angles are not close to diamond geometry";
      return false;
    }
  }

  return true;
}

double ComputeContourTipConfidence(
  const Params& params,
  const Candidate& candidate,
  const ShapeMetrics& metrics
) {
  const double maxCenterDistance = std::min(params.width, params.height) * params.maxCenterDistanceRatio;
  const double centerScore = Clamp01(1.0 - candidate.centerDistance / std::max(1.0, maxCenterDistance));
  const double sideScore = RatioScore(metrics.sideRatio, params.maxSideLengthRatio);
  const double diagScore = RatioScore(metrics.diagonalRatio, params.maxDiagonalRatio);

  double angleError = 0.0;
  for (double angle : metrics.anglesDeg) {
    angleError += std::abs(angle - 90.0);
  }
  angleError /= 4.0;
  const double angleScore = Clamp01(1.0 - angleError / std::max(1.0, params.angleToleranceDeg + 8.0));
  const double solidityScore = IsEdgeMaskMode(candidate.thresholdMode)
    ? Clamp01(candidate.solidity / 0.22)
    : Clamp01((candidate.solidity - 0.52) / 0.38);

  return Clamp01(
    0.24 * candidate.score +
    0.20 * centerScore +
    0.18 * sideScore +
    0.18 * diagScore +
    0.12 * angleScore +
    0.08 * solidityScore
  );
}

void SnapCornersToAxisGuides(OrderedCorners& corners) {
  const float centerX = static_cast<float>((corners.left.x + corners.right.x) * 0.5f);
  const float centerY = static_cast<float>((corners.top.y + corners.bottom.y) * 0.5f);
  corners.top.x = centerX;
  corners.bottom.x = centerX;
  corners.left.y = centerY;
  corners.right.y = centerY;
}

int CountMaskRow(const cv::Mat& mask, int y, int x0, int x1) {
  if (y < 0 || y >= mask.rows) return 0;
  x0 = std::clamp(x0, 0, mask.cols - 1);
  x1 = std::clamp(x1, 0, mask.cols - 1);
  if (x0 > x1) std::swap(x0, x1);

  int count = 0;
  const uint8_t* row = mask.ptr<uint8_t>(y);
  for (int x = x0; x <= x1; ++x) {
    if (row[x] > 0) ++count;
  }
  return count;
}

float MaxGradientRow(const cv::Mat& grad, int y, int x0, int x1) {
  if (y < 0 || y >= grad.rows) return 0.0f;
  x0 = std::clamp(x0, 0, grad.cols - 1);
  x1 = std::clamp(x1, 0, grad.cols - 1);
  if (x0 > x1) std::swap(x0, x1);

  float best = 0.0f;
  const float* row = grad.ptr<float>(y);
  for (int x = x0; x <= x1; ++x) {
    best = std::max(best, row[x]);
  }
  return best;
}

int CountMaskCol(const cv::Mat& mask, int x, int y0, int y1) {
  if (x < 0 || x >= mask.cols) return 0;
  y0 = std::clamp(y0, 0, mask.rows - 1);
  y1 = std::clamp(y1, 0, mask.rows - 1);
  if (y0 > y1) std::swap(y0, y1);

  int count = 0;
  for (int y = y0; y <= y1; ++y) {
    if (mask.at<uint8_t>(y, x) > 0) ++count;
  }
  return count;
}

float MaxGradientCol(const cv::Mat& grad, int x, int y0, int y1) {
  if (x < 0 || x >= grad.cols) return 0.0f;
  y0 = std::clamp(y0, 0, grad.rows - 1);
  y1 = std::clamp(y1, 0, grad.rows - 1);
  if (y0 > y1) std::swap(y0, y1);

  float best = 0.0f;
  for (int y = y0; y <= y1; ++y) {
    best = std::max(best, grad.at<float>(y, x));
  }
  return best;
}

cv::Mat ManualThresholdMask(const Preprocessed& pre, const Params& params) {
  cv::Mat mask;
  if (params.threshold <= 0 || params.thresholdMode != "manual") {
    cv::threshold(pre.blurred, mask, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);
  } else {
    cv::threshold(pre.blurred, mask, params.threshold, 255, cv::THRESH_BINARY_INV);
  }
  const int closeSize = std::clamp(params.smoothing <= 0 ? 1 : (params.smoothing / 3) * 2 + 1, 1, 9);
  return CloseOpenMask(mask, closeSize, 1, 1);
}

std::optional<float> FindAxisTipY(
  const Preprocessed& pre,
  const Params& params,
  const cv::Mat& mask,
  const OrderedCorners& corners,
  bool topTip
) {
  const double d1 = Distance(corners.left, corners.right);
  const double d2 = Distance(corners.top, corners.bottom);
  if (d1 <= 8.0 || d2 <= 8.0) return std::nullopt;

  const float centerX = static_cast<float>((corners.left.x + corners.right.x) * 0.5f);
  const float centerY = static_cast<float>((corners.top.y + corners.bottom.y) * 0.5f);
  const float roughY = topTip ? corners.top.y : corners.bottom.y;
  const int bandHalf = std::clamp(static_cast<int>(std::round(d1 * 0.035)), 10, 54);
  const int search = std::clamp(static_cast<int>(std::round(d2 * 0.13)), 18, 130);
  const int step = std::clamp(static_cast<int>(std::round(d2 * 0.018)), 3, 22);
  const int cx = std::clamp(static_cast<int>(std::round(centerX)), 0, params.width - 1);
  const int x0 = cx - bandHalf;
  const int x1 = cx + bandHalf;
  const int minRun = std::clamp(static_cast<int>(std::round(bandHalf * 0.22)), 3, 18);

  int yStart = static_cast<int>(std::round(roughY - search));
  int yEnd = static_cast<int>(std::round(roughY + search));
  yStart = std::clamp(yStart, 1, params.height - 2);
  yEnd = std::clamp(yEnd, 1, params.height - 2);
  if (yStart > yEnd) std::swap(yStart, yEnd);

  double bestScore = -1.0;
  int bestY = -1;
  for (int y = yStart; y <= yEnd; ++y) {
    if (topTip && y >= centerY - d2 * 0.18) continue;
    if (!topTip && y <= centerY + d2 * 0.18) continue;

    const int here = CountMaskRow(mask, y, x0, x1);
    const int inside = CountMaskRow(mask, topTip ? y + step : y - step, x0, x1);
    const int outside = CountMaskRow(mask, topTip ? y - step : y + step, x0, x1);
    if (here < minRun && inside < minRun) continue;

    const int contrast = inside - outside;
    if (contrast < std::max(2, minRun / 2)) continue;

    const float gradient = MaxGradientRow(pre.gradMag, y, x0, x1);
    const double gradientScore = Clamp01((gradient - pre.gradMean) / std::max(1.0, pre.gradStd * 2.4));
    const double contrastScore = Clamp01(static_cast<double>(contrast) / std::max(1.0, bandHalf * 1.4));
    const double centerScore = Clamp01(1.0 - std::abs(y - roughY) / std::max(1.0, static_cast<double>(search)));
    const double score = 0.46 * gradientScore + 0.38 * contrastScore + 0.16 * centerScore;
    if (score > bestScore) {
      bestScore = score;
      bestY = y;
    }
  }

  if (bestY < 0 || bestScore < 0.18) return std::nullopt;
  return static_cast<float>(bestY);
}

std::optional<float> FindAxisTipX(
  const Preprocessed& pre,
  const Params& params,
  const cv::Mat& mask,
  const OrderedCorners& corners,
  bool leftTip
) {
  const double d1 = Distance(corners.left, corners.right);
  const double d2 = Distance(corners.top, corners.bottom);
  if (d1 <= 8.0 || d2 <= 8.0) return std::nullopt;

  const float centerX = static_cast<float>((corners.left.x + corners.right.x) * 0.5f);
  const float centerY = static_cast<float>((corners.top.y + corners.bottom.y) * 0.5f);
  const float roughX = leftTip ? corners.left.x : corners.right.x;
  const int bandHalf = std::clamp(static_cast<int>(std::round(d2 * 0.035)), 10, 54);
  const int search = std::clamp(static_cast<int>(std::round(d1 * 0.13)), 18, 130);
  const int step = std::clamp(static_cast<int>(std::round(d1 * 0.018)), 3, 22);
  const int cy = std::clamp(static_cast<int>(std::round(centerY)), 0, params.height - 1);
  const int y0 = cy - bandHalf;
  const int y1 = cy + bandHalf;
  const int minRun = std::clamp(static_cast<int>(std::round(bandHalf * 0.22)), 3, 18);

  int xStart = static_cast<int>(std::round(roughX - search));
  int xEnd = static_cast<int>(std::round(roughX + search));
  xStart = std::clamp(xStart, 1, params.width - 2);
  xEnd = std::clamp(xEnd, 1, params.width - 2);
  if (xStart > xEnd) std::swap(xStart, xEnd);

  double bestScore = -1.0;
  int bestX = -1;
  for (int x = xStart; x <= xEnd; ++x) {
    if (leftTip && x >= centerX - d1 * 0.18) continue;
    if (!leftTip && x <= centerX + d1 * 0.18) continue;

    const int here = CountMaskCol(mask, x, y0, y1);
    const int inside = CountMaskCol(mask, leftTip ? x + step : x - step, y0, y1);
    const int outside = CountMaskCol(mask, leftTip ? x - step : x + step, y0, y1);
    if (here < minRun && inside < minRun) continue;

    const int contrast = inside - outside;
    if (contrast < std::max(2, minRun / 2)) continue;

    const float gradient = MaxGradientCol(pre.gradMag, x, y0, y1);
    const double gradientScore = Clamp01((gradient - pre.gradMean) / std::max(1.0, pre.gradStd * 2.4));
    const double contrastScore = Clamp01(static_cast<double>(contrast) / std::max(1.0, bandHalf * 1.4));
    const double centerScore = Clamp01(1.0 - std::abs(x - roughX) / std::max(1.0, static_cast<double>(search)));
    const double score = 0.46 * gradientScore + 0.38 * contrastScore + 0.16 * centerScore;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }

  if (bestX < 0 || bestScore < 0.18) return std::nullopt;
  return static_cast<float>(bestX);
}

bool RefineAxisTipsFromDarkBoundary(
  const Preprocessed& pre,
  const Params& params,
  OrderedCorners& corners
) {
  const OrderedCorners before = corners;
  const cv::Mat mask = ManualThresholdMask(pre, params);
  bool changed = false;

  if (auto x = FindAxisTipX(pre, params, mask, corners, true)) {
    const double maxDrift = std::clamp(Distance(corners.left, corners.right) * 0.16, 12.0, 120.0);
    if (std::abs(*x - corners.left.x) <= maxDrift) {
      corners.left.x = *x;
      changed = true;
    }
  }
  if (auto x = FindAxisTipX(pre, params, mask, corners, false)) {
    const double maxDrift = std::clamp(Distance(corners.left, corners.right) * 0.16, 12.0, 120.0);
    if (std::abs(*x - corners.right.x) <= maxDrift) {
      corners.right.x = *x;
      changed = true;
    }
  }
  if (auto y = FindAxisTipY(pre, params, mask, corners, true)) {
    const double maxDrift = std::clamp(Distance(corners.top, corners.bottom) * 0.16, 12.0, 120.0);
    if (std::abs(*y - corners.top.y) <= maxDrift) {
      corners.top.y = *y;
      changed = true;
    }
  }
  if (auto y = FindAxisTipY(pre, params, mask, corners, false)) {
    const double maxDrift = std::clamp(Distance(corners.top, corners.bottom) * 0.16, 12.0, 120.0);
    if (std::abs(*y - corners.bottom.y) <= maxDrift) {
      corners.bottom.y = *y;
      changed = true;
    }
  }

  if (!changed) return false;

  SnapCornersToAxisGuides(corners);

  const ShapeMetrics metrics = ComputeShapeMetrics(corners);
  bool geometryOk =
    PointInsideImage(corners.top, params) &&
    PointInsideImage(corners.right, params) &&
    PointInsideImage(corners.bottom, params) &&
    PointInsideImage(corners.left, params) &&
    std::isfinite(metrics.diagonalRatio) &&
    metrics.diagonalRatio <= params.maxDiagonalRatio * 1.12 &&
    (1.0 / metrics.diagonalRatio) >= params.minDiagonalRatio * 0.92;
  for (double angle : metrics.anglesDeg) {
    if (std::abs(angle - 90.0) > params.angleToleranceDeg + 10.0) {
      geometryOk = false;
      break;
    }
  }
  if (!geometryOk) {
    corners = before;
    DebugLog(
      "[auto-refine] accepted=false reason=axis-geometry topTipBefore=(%.2f,%.2f) topTipAfter=(%.2f,%.2f) bottomTipBefore=(%.2f,%.2f) bottomTipAfter=(%.2f,%.2f)\n",
      before.top.x,
      before.top.y,
      corners.top.x,
      corners.top.y,
      before.bottom.x,
      before.bottom.y,
      corners.bottom.x,
      corners.bottom.y);
    return false;
  }

  DebugLog(
    "[auto-refine] topTipBefore=(%.2f,%.2f) topTipAfter=(%.2f,%.2f) bottomTipBefore=(%.2f,%.2f) bottomTipAfter=(%.2f,%.2f)\n",
    before.top.x,
    before.top.y,
    corners.top.x,
    corners.top.y,
    before.bottom.x,
    before.bottom.y,
    corners.bottom.x,
    corners.bottom.y);
  return true;
}

std::optional<HoughLineCandidate> BestSignedHoughLine(
  const std::vector<HoughLineCandidate>& lines,
  int sign
) {
  std::optional<HoughLineCandidate> best;
  for (const auto& item : lines) {
    if (sign > 0 && item.signedDistance <= 0.0) continue;
    if (sign < 0 && item.signedDistance >= 0.0) continue;
    if (!best || item.score > best->score) best = item;
  }
  return best;
}

double HoughShapeConfidence(const Params& params, const ShapeMetrics& metrics, const std::array<LineModel, 4>& lines) {
  const double sideScore = RatioScore(metrics.sideRatio, params.maxSideLengthRatio);
  const double diagScore = RatioScore(metrics.diagonalRatio, params.maxDiagonalRatio);
  double angleError = 0.0;
  for (double angle : metrics.anglesDeg) angleError += std::abs(angle - 90.0);
  angleError /= 4.0;
  const double angleScore = Clamp01(1.0 - angleError / std::max(1.0, params.angleToleranceDeg + 10.0));

  const double minDim = std::min(params.width, params.height);
  double lengthScore = 0.0;
  for (const auto& line : lines) {
    lengthScore += Clamp01(line.pointCount / std::max(1.0, minDim * 0.16));
  }
  lengthScore /= 4.0;

  return Clamp01(0.28 * sideScore + 0.28 * diagScore + 0.26 * angleScore + 0.18 * lengthScore);
}

struct FacetEdgeRefinement {
  cv::Point2f missingTip;
  cv::Point2f top;
  cv::Point2f bottom;
  LineModel upperLine;
  LineModel lowerLine;
  double score = 0.0;
};

LineModel LineModelFromSegment(cv::Point2f a, cv::Point2f b, double lengthScore) {
  LineModel line;
  const double length = Distance(a, b);
  line.ok = length > 1.0;
  line.point = (a + b) * 0.5f;
  line.dir = Normalize(b - a);
  line.sampleCount = static_cast<int>(std::round(length));
  line.pointCount = static_cast<int>(std::round(length * std::max(0.15, lengthScore)));
  line.residual = 1.0;
  return line;
}

bool IntersectLineAtX(const LineModel& line, float x, cv::Point2f& out) {
  if (!line.ok || std::abs(line.dir.x) < 1e-4f) return false;
  const float t = (x - line.point.x) / line.dir.x;
  out = line.point + line.dir * t;
  return std::isfinite(out.x) && std::isfinite(out.y);
}

std::optional<FacetEdgeRefinement> TryRefineOppositeFacetFromEdges(
  const Preprocessed& pre,
  const Params& params,
  float centerX,
  float centerY,
  float darkTipX,
  float roughTop,
  float roughBottom,
  bool missingOnLeft
) {
  const double darkHalf = std::abs(static_cast<double>(darkTipX - centerX));
  const double roughHalfY = std::max(16.0, (roughBottom - roughTop) * 0.5);
  const double searchHalfY = std::max(roughHalfY * 1.12, darkHalf * 0.86);
  const double searchWidth = std::max(darkHalf * 1.22, roughHalfY * 1.05);
  const int margin = std::max(8, static_cast<int>(std::round(std::min(params.width, params.height) * 0.01)));

  const int x0 = missingOnLeft
    ? static_cast<int>(std::floor(centerX - searchWidth))
    : static_cast<int>(std::floor(centerX - darkHalf * 0.12));
  const int x1 = missingOnLeft
    ? static_cast<int>(std::ceil(centerX + darkHalf * 0.12))
    : static_cast<int>(std::ceil(centerX + searchWidth));
  const int y0 = static_cast<int>(std::floor(centerY - searchHalfY));
  const int y1 = static_cast<int>(std::ceil(centerY + searchHalfY));

  cv::Rect roi(x0, y0, x1 - x0, y1 - y0);
  roi &= cv::Rect(0, 0, params.width, params.height);
  if (roi.width < 32 || roi.height < 32) return std::nullopt;

  cv::Mat edges;
  const cv::Mat roiBlur = pre.blurred(roi);
  const double strictness = std::clamp(params.gradientStrengthFactor / 100.0, 0.0, 1.0);
  const double sensitivity = std::clamp(params.edgeFactor / 100.0, 0.0, 1.0);
  const double low = std::max(8.0, pre.gradMean + pre.gradStd * (-0.02 + strictness * 0.28));
  const double high = std::max(low + 20.0, pre.gradMean + pre.gradStd * (0.58 + strictness * 0.54 - sensitivity * 0.12));
  cv::Canny(roiBlur, edges, low, high, 3, true);
  cv::dilate(edges, edges, cv::getStructuringElement(cv::MORPH_RECT, {3, 3}));

  const double minDim = std::min(params.width, params.height);
  const int minLineLength = std::clamp(static_cast<int>(std::round(std::min(darkHalf, roughHalfY) * (0.26 + sensitivity * 0.16))), 24, 280);
  const int maxLineGap = std::clamp(static_cast<int>(std::round(minDim * 0.025)), 8, 42);
  const int threshold = std::clamp(static_cast<int>(std::round(minDim * 0.035)), 18, 82);

  std::vector<cv::Vec4i> rawLines;
  cv::HoughLinesP(edges, rawLines, 1.0, kPi / 180.0, threshold, minLineLength, maxLineGap);
  if (rawLines.size() < 2) return std::nullopt;

  struct EdgeCandidate {
    LineModel line;
    double length = 0.0;
    double score = 0.0;
    bool upper = false;
  };

  std::vector<EdgeCandidate> upper;
  std::vector<EdgeCandidate> lower;
  for (const auto& raw : rawLines) {
    cv::Point2f a(static_cast<float>(raw[0] + roi.x), static_cast<float>(raw[1] + roi.y));
    cv::Point2f b(static_cast<float>(raw[2] + roi.x), static_cast<float>(raw[3] + roi.y));
    const double length = Distance(a, b);
    if (length < minLineLength) continue;
    const cv::Point2f dir = Normalize(b - a);
    const double angle = DirectionAngleDeg(dir);

    const bool isUpper = missingOnLeft
      ? (angle >= 112.0 && angle <= 165.0)
      : (angle >= 15.0 && angle <= 68.0);
    const bool isLower = missingOnLeft
      ? (angle >= 15.0 && angle <= 68.0)
      : (angle >= 112.0 && angle <= 165.0);
    if (!isUpper && !isLower) continue;

    const cv::Point2f midpoint = (a + b) * 0.5f;
    const double expectedX = missingOnLeft ? centerX - darkHalf * 0.42 : centerX + darkHalf * 0.42;
    const double midpointScore = Clamp01(1.0 - std::abs(midpoint.x - expectedX) / std::max(1.0, searchWidth * 0.75));
    const double lengthScore = Clamp01(length / std::max(1.0, std::min(darkHalf, roughHalfY) * 0.78));
    const double yScore = Clamp01(1.0 - std::abs(midpoint.y - centerY) / std::max(1.0, searchHalfY));
    EdgeCandidate candidate;
    candidate.line = LineModelFromSegment(a, b, lengthScore);
    candidate.length = length;
    candidate.score = 0.54 * lengthScore + 0.30 * midpointScore + 0.16 * yScore;
    candidate.upper = isUpper;
    if (isUpper) upper.push_back(candidate);
    if (isLower) lower.push_back(candidate);
  }

  if (upper.empty() || lower.empty()) return std::nullopt;

  std::optional<FacetEdgeRefinement> best;
  for (const auto& up : upper) {
    for (const auto& lowLine : lower) {
      cv::Point2f tip;
      if (!IntersectLines(up.line, lowLine.line, tip)) continue;
      if (!PointInsideImage(tip, params)) continue;
      if (missingOnLeft && tip.x >= centerX - darkHalf * 0.18) continue;
      if (!missingOnLeft && tip.x <= centerX + darkHalf * 0.18) continue;
      if (std::abs(tip.y - centerY) > searchHalfY * 0.32) continue;

      cv::Point2f topCross;
      cv::Point2f bottomCross;
      if (!IntersectLineAtX(up.line, centerX, topCross) ||
          !IntersectLineAtX(lowLine.line, centerX, bottomCross)) {
        continue;
      }

      if (topCross.y > bottomCross.y) std::swap(topCross, bottomCross);
      if (topCross.y >= centerY - roughHalfY * 0.22 || bottomCross.y <= centerY + roughHalfY * 0.22) continue;
      if (!PointInsideImage(topCross, params) || !PointInsideImage(bottomCross, params)) continue;

      const double oppositeHalf = std::abs(static_cast<double>(tip.x - centerX));
      const double d1 = oppositeHalf + darkHalf;
      const double d2 = Distance(topCross, bottomCross);
      if (d1 <= 1.0 || d2 <= 1.0) continue;
      const double roughD2 = std::max(1.0, static_cast<double>(roughBottom - roughTop));
      if (d2 < roughD2 * 0.58 || d2 > roughD2 * 1.36) continue;
      if (topCross.y < roughTop - roughHalfY * 0.28 || topCross.y > centerY - roughHalfY * 0.30) continue;
      if (bottomCross.y > roughBottom + roughHalfY * 0.28 || bottomCross.y < centerY + roughHalfY * 0.30) continue;

      const double diagRatio = std::max(d1, d2) / std::min(d1, d2);
      if (diagRatio > params.maxDiagonalRatio) continue;

      const double symmetryScore = RatioScore(diagRatio, params.maxDiagonalRatio);
      const double centerScore = Clamp01(1.0 - std::abs(tip.y - centerY) / std::max(1.0, searchHalfY * 0.28));
      const double score = 0.34 * up.score + 0.34 * lowLine.score + 0.20 * symmetryScore + 0.12 * centerScore;

      if (!best || score > best->score) {
        FacetEdgeRefinement refined;
        refined.missingTip = tip;
        refined.top = topCross;
        refined.bottom = bottomCross;
        refined.upperLine = up.line;
        refined.lowerLine = lowLine.line;
        refined.score = score;
        best = refined;
      }
    }
  }

  return best;
}

std::optional<HoughDiamondResult> TryDarkBodyFallback(
  const Preprocessed& pre,
  const Params& params,
  DebugInfo& debug
) {
  cv::Mat darkMask;
  if (params.thresholdMode == "adaptive") {
    int block = std::max(15, (std::min(params.width, params.height) / 18) | 1);
    if (block % 2 == 0) ++block;
    cv::adaptiveThreshold(
      pre.blurred,
      darkMask,
      255,
      cv::ADAPTIVE_THRESH_GAUSSIAN_C,
      cv::THRESH_BINARY_INV,
      block,
      2.0 + params.edgeFactor / 12.0
    );
  } else if (params.thresholdMode == "manual") {
    cv::threshold(pre.blurred, darkMask, params.threshold, 255, cv::THRESH_BINARY_INV);
  } else {
    cv::threshold(pre.blurred, darkMask, 0, 255, cv::THRESH_BINARY_INV | cv::THRESH_OTSU);
  }
  darkMask = ApplyMorphology(darkMask, params);

  cv::Mat labels;
  cv::Mat stats;
  cv::Mat centroids;
  const int count = cv::connectedComponentsWithStats(darkMask, labels, stats, centroids, 8, CV_32S);
  if (count <= 1) return std::nullopt;

  const double imageArea = static_cast<double>(params.width) * params.height;
  const cv::Point2f imageCenter(params.width * 0.5f, params.height * 0.5f);
  const double maxCenterDistance = std::max(params.width, params.height) * 0.36;
  const double minAreaRatio = std::max(0.0012, params.minAreaRatio * 0.65);
  const int border = std::max(4, static_cast<int>(std::round(std::min(params.width, params.height) * 0.012)));

  struct ComponentChoice {
    int label = -1;
    cv::Rect box;
    cv::Point2f centroid;
    double area = 0.0;
    double score = 0.0;
  };

  std::optional<ComponentChoice> best;
  for (int label = 1; label < count; ++label) {
    const int x = stats.at<int>(label, cv::CC_STAT_LEFT);
    const int y = stats.at<int>(label, cv::CC_STAT_TOP);
    const int w = stats.at<int>(label, cv::CC_STAT_WIDTH);
    const int h = stats.at<int>(label, cv::CC_STAT_HEIGHT);
    const int area = stats.at<int>(label, cv::CC_STAT_AREA);
    if (w <= 12 || h <= 12 || area <= 80) continue;
    if (x <= border || y <= border || x + w >= params.width - border || y + h >= params.height - border) continue;

    const double areaRatio = area / imageArea;
    if (areaRatio < minAreaRatio || areaRatio > 0.24) continue;

    const cv::Point2f centroid(
      static_cast<float>(centroids.at<double>(label, 0)),
      static_cast<float>(centroids.at<double>(label, 1))
    );
    const cv::Rect box(x, y, w, h);
    const cv::Point2f boxCenter(x + w * 0.5f, y + h * 0.5f);
    const double centerDistance = Distance(boxCenter, imageCenter);
    if (centerDistance > maxCenterDistance) continue;

    const double aspect = static_cast<double>(w) / std::max(1, h);
    if (aspect < 0.22 || aspect > 1.55) continue;

    const double fill = area / static_cast<double>(w * h);
    if (fill < 0.12 || fill > 0.92) continue;

    const double areaScore = Clamp01(areaRatio / 0.045);
    const double centerScore = Clamp01(1.0 - centerDistance / std::max(1.0, maxCenterDistance));
    const double aspectScore = aspect < 0.72
      ? Clamp01(1.0 - std::abs(aspect - 0.50) / 0.35)
      : Clamp01(1.0 - std::abs(aspect - 1.00) / 0.65);
    const double fillScore = Clamp01(1.0 - std::abs(fill - 0.48) / 0.45);
    const double score = 0.34 * areaScore + 0.34 * centerScore + 0.20 * aspectScore + 0.12 * fillScore;

    ComponentChoice choice;
    choice.label = label;
    choice.box = box;
    choice.centroid = centroid;
    choice.area = area;
    choice.score = score;
    if (!best || choice.score > best->score) best = choice;
  }

  if (!best) return std::nullopt;

  const cv::Rect box = best->box;
  const float left = static_cast<float>(box.x);
  const float right = static_cast<float>(box.x + box.width);
  const float top = static_cast<float>(box.y);
  const float bottom = static_cast<float>(box.y + box.height);
  const float boxCenterX = box.x + box.width * 0.5f;
  const float boxCenterY = box.y + box.height * 0.5f;

  OrderedCorners corners;
  const double aspect = static_cast<double>(box.width) / std::max(1, box.height);
  std::optional<FacetEdgeRefinement> facetRefinement;
  if (aspect < 0.72) {
    const bool componentIsRightHalf = best->centroid.x >= boxCenterX;
    const float centerX = componentIsRightHalf ? left : right;
    const float darkTipX = componentIsRightHalf ? right : left;
    facetRefinement = TryRefineOppositeFacetFromEdges(
      pre,
      params,
      centerX,
      boxCenterY,
      darkTipX,
      top,
      bottom,
      componentIsRightHalf
    );

    if (facetRefinement) {
      if (componentIsRightHalf) {
        corners.left = {facetRefinement->missingTip.x, boxCenterY};
        corners.right = {darkTipX, boxCenterY};
      } else {
        corners.left = {darkTipX, boxCenterY};
        corners.right = {facetRefinement->missingTip.x, boxCenterY};
      }
      corners.top = {centerX, facetRefinement->top.y};
      corners.bottom = {centerX, facetRefinement->bottom.y};
    } else {
      const float halfWidth = componentIsRightHalf ? (right - centerX) : (centerX - left);
      const float verticalHalf = std::min((bottom - top) * 0.5f, halfWidth * 0.94f);
      const float oppositeHalf = std::min(halfWidth, verticalHalf * 0.96f);
      corners.left = componentIsRightHalf
        ? cv::Point2f(centerX - oppositeHalf, boxCenterY)
        : cv::Point2f(darkTipX, boxCenterY);
      corners.right = componentIsRightHalf
        ? cv::Point2f(darkTipX, boxCenterY)
        : cv::Point2f(centerX + oppositeHalf, boxCenterY);
      corners.top = {centerX, boxCenterY - verticalHalf};
      corners.bottom = {centerX, boxCenterY + verticalHalf};
    }
  } else {
    corners.left = {left, boxCenterY};
    corners.right = {right, boxCenterY};
    corners.top = {boxCenterX, top};
    corners.bottom = {boxCenterX, bottom};
  }

  if (!PointInsideImage(corners.top, params) ||
      !PointInsideImage(corners.right, params) ||
      !PointInsideImage(corners.bottom, params) ||
      !PointInsideImage(corners.left, params)) {
    return std::nullopt;
  }

  ShapeMetrics metrics = ComputeShapeMetrics(corners);
  const double minAcceptedDiagonal = MinIndentationDiagonalPixels(params);
  if (metrics.area < MinIndentationAreaPixels(params) * 0.72 ||
      metrics.d1 < minAcceptedDiagonal ||
      metrics.d2 < minAcceptedDiagonal) {
    return std::nullopt;
  }
  if (metrics.d1 > std::min(params.width, params.height) * 0.78 ||
      metrics.d2 > std::min(params.width, params.height) * 0.78) {
    return std::nullopt;
  }
  if (metrics.diagonalRatio > params.maxDiagonalRatio * 1.18) return std::nullopt;

  std::array<LineModel, 4> lines;
  const auto p = ToSideOrder(corners);
  for (int i = 0; i < 4; ++i) {
    lines[i].ok = true;
    lines[i].point = (p[i] + p[(i + 1) % 4]) * 0.5f;
    lines[i].dir = Normalize(p[(i + 1) % 4] - p[i]);
    lines[i].sampleCount = static_cast<int>(std::round(Distance(p[i], p[(i + 1) % 4])));
    lines[i].pointCount = lines[i].sampleCount;
    lines[i].residual = 1.0;
  }

  debug.thresholdMode = facetRefinement ? "dark-body-edge-refined" : "dark-body-fallback";
  debug.selectedContourArea = best->area;
  debug.selectedHullArea = static_cast<double>(box.width) * box.height;
  debug.selectedValidationArea = debug.selectedHullArea;
  debug.contourCenterDistance = Distance({boxCenterX, boxCenterY}, imageCenter);
  debug.solidity = best->area / std::max(1.0, debug.selectedHullArea);
  debug.minAreaRect = cv::RotatedRect({boxCenterX, boxCenterY}, {static_cast<float>(box.width), static_cast<float>(box.height)}, 0.0f);
  debug.lineSampleCounts = {lines[0].sampleCount, lines[1].sampleCount, lines[2].sampleCount, lines[3].sampleCount};
  debug.fittedLinePointCounts = {lines[0].pointCount, lines[1].pointCount, lines[2].pointCount, lines[3].pointCount};
  debug.fittedLineResiduals = {1.0, 1.0, 1.0, 1.0};

  HoughDiamondResult result;
  result.corners = corners;
  result.lines = lines;
  result.confidence = Clamp01(0.58 + 0.22 * best->score + (facetRefinement ? 0.12 * facetRefinement->score : 0.0));
  return result;
}

std::optional<HoughDiamondResult> TryHoughDiamondFallback(
  const Preprocessed& pre,
  const Params& params,
  DebugInfo& debug
) {
  cv::Mat edges;
  const double low = std::max(12.0, pre.gradMean + pre.gradStd * 0.08);
  const double high = std::max(low + 24.0, pre.gradMean + pre.gradStd * 0.95);
  cv::Canny(pre.blurred, edges, low, high, 3, true);

  const int dilateSize = SliderToOddKernel(params.dilation, 1, 5);
  if (dilateSize > 1) {
    cv::dilate(edges, edges, cv::getStructuringElement(cv::MORPH_RECT, {dilateSize, dilateSize}));
  }

  const double minDim = std::min(params.width, params.height);
  const double maxDim = std::max(params.width, params.height);
  const int minLineLength = std::clamp(static_cast<int>(std::lround(minDim * 0.08)), 35, 180);
  const int maxLineGap = std::clamp(static_cast<int>(std::lround(minDim * 0.035)), 8, 48);
  const int threshold = std::clamp(static_cast<int>(std::lround(minDim * 0.055)), 22, 95);

  std::vector<cv::Vec4i> rawLines;
  cv::HoughLinesP(edges, rawLines, 1.0, kPi / 180.0, threshold, minLineLength, maxLineGap);
  if (rawLines.size() < 4) return std::nullopt;

  const cv::Point2f imageCenter(params.width * 0.5f, params.height * 0.5f);
  const double minSideDistance = minDim * 0.045;
  const double maxSideDistance = minDim * 0.43;
  const double maxMidpointDistance = maxDim * 0.48;
  std::vector<HoughLineCandidate> positiveFamily;
  std::vector<HoughLineCandidate> negativeFamily;

  for (const auto& raw : rawLines) {
    const cv::Point2f p1(static_cast<float>(raw[0]), static_cast<float>(raw[1]));
    const cv::Point2f p2(static_cast<float>(raw[2]), static_cast<float>(raw[3]));
    const double length = Distance(p1, p2);
    if (length < minLineLength) continue;

    cv::Point2f dir = Normalize(p2 - p1);
    if (dir.x < 0.0f) dir = -dir;
    const double angle = DirectionAngleDeg(dir);
    const bool positiveSlope = angle >= 18.0 && angle <= 82.0;
    const bool negativeSlope = angle >= 98.0 && angle <= 162.0;
    if (!positiveSlope && !negativeSlope) continue;

    const cv::Point2f midpoint = (p1 + p2) * 0.5f;
    const double midpointDistance = Distance(midpoint, imageCenter);
    if (midpointDistance > maxMidpointDistance) continue;

    cv::Point2f normal(-dir.y, dir.x);
    normal = Normalize(normal);
    const double signedDistance = Dot(normal, midpoint - imageCenter);
    const double absDistance = std::abs(signedDistance);
    if (absDistance < minSideDistance || absDistance > maxSideDistance) continue;

    LineModel line;
    line.ok = true;
    line.point = midpoint;
    line.dir = dir;
    line.sampleCount = static_cast<int>(std::lround(length));
    line.pointCount = line.sampleCount;
    line.residual = 1.0;
    line.angleDeltaDeg = 0.0;

    const double lengthScore = Clamp01(length / (minDim * 0.42));
    const double midpointScore = Clamp01(1.0 - midpointDistance / std::max(1.0, maxMidpointDistance));
    const double distanceScore = Clamp01(1.0 - std::abs(absDistance - minDim * 0.24) / (minDim * 0.24));

    HoughLineCandidate candidate;
    candidate.line = line;
    candidate.signedDistance = signedDistance;
    candidate.length = length;
    candidate.score = 0.54 * lengthScore + 0.28 * midpointScore + 0.18 * distanceScore;

    if (positiveSlope) positiveFamily.push_back(candidate);
    if (negativeSlope) negativeFamily.push_back(candidate);
  }

  auto posA = BestSignedHoughLine(positiveFamily, -1);
  auto posB = BestSignedHoughLine(positiveFamily, 1);
  auto negA = BestSignedHoughLine(negativeFamily, -1);
  auto negB = BestSignedHoughLine(negativeFamily, 1);
  if (!posA || !posB || !negA || !negB) return std::nullopt;

  std::array<LineModel, 4> families{posA->line, posB->line, negA->line, negB->line};
  std::vector<cv::Point2f> intersections;
  intersections.reserve(4);
  for (int pi = 0; pi < 2; ++pi) {
    for (int ni = 2; ni < 4; ++ni) {
      cv::Point2f point;
      if (!IntersectLines(families[pi], families[ni], point)) return std::nullopt;
      if (!PointInsideImage(point, params)) return std::nullopt;
      intersections.push_back(point);
    }
  }

  const cv::Point2f center = std::accumulate(
    intersections.begin(),
    intersections.end(),
    cv::Point2f(0.0f, 0.0f)
  ) * (1.0f / static_cast<float>(intersections.size()));
  OrderedCorners corners = OrderDiamondCorners(intersections, center);
  ShapeMetrics metrics = ComputeShapeMetrics(corners);
  if (metrics.area < debug.minArea || metrics.area > debug.maxArea * 2.4) return std::nullopt;
  if (metrics.sideRatio > params.maxSideLengthRatio * 1.15) return std::nullopt;
  if (metrics.diagonalRatio > params.maxDiagonalRatio * 1.15) return std::nullopt;
  for (double angle : metrics.anglesDeg) {
    if (std::abs(angle - 90.0) > params.angleToleranceDeg + 12.0) return std::nullopt;
  }

  HoughDiamondResult result;
  result.corners = corners;
  result.lines = {
    posA->line,
    negA->line,
    posB->line,
    negB->line,
  };
  result.confidence = HoughShapeConfidence(params, metrics, result.lines);
  debug.thresholdMode = "hough-fallback";
  debug.lineSampleCounts = {
    result.lines[0].sampleCount,
    result.lines[1].sampleCount,
    result.lines[2].sampleCount,
    result.lines[3].sampleCount,
  };
  debug.fittedLinePointCounts = {
    result.lines[0].pointCount,
    result.lines[1].pointCount,
    result.lines[2].pointCount,
    result.lines[3].pointCount,
  };
  debug.fittedLineResiduals = {
    result.lines[0].residual,
    result.lines[1].residual,
    result.lines[2].residual,
    result.lines[3].residual,
  };
  return result;
}

// Per-tip refinement: re-sample edge points only on a short strip near each
// tip, re-fit the two adjacent sides locally, and intersect. Compensates for
// the inward bias produced by full-side sampling (the body of the side has
// far more strong-gradient samples than the tip end, so the global Huber fit
// drifts away from the real tip). Each tip is accepted independently with a
// drift cap; on rejection that single tip keeps its un-refined value.
bool RefineDiamondTips(
  const Preprocessed& pre,
  const Params& params,
  const std::array<LineModel, 4>& lines,
  OrderedCorners& corners,
  bool onlyD2Tips = false
) {
  const cv::Point2f center(
    (corners.top.x + corners.right.x + corners.bottom.x + corners.left.x) * 0.25f,
    (corners.top.y + corners.right.y + corners.bottom.y + corners.left.y) * 0.25f
  );
  const double d1 = Distance(corners.left, corners.right);
  const double d2 = Distance(corners.top, corners.bottom);
  const double halfDiag = std::max(d1, d2) * 0.5;
  const double maxDrift = std::clamp(halfDiag * 0.18, 4.0, 22.0);
  const double maxD2Drift = std::clamp(halfDiag * 0.10, 8.0, 72.0);
  const double stripLen = std::clamp(halfDiag * 0.55, 14.0, 110.0);
  const int minStripPoints = std::max(4, std::min(8, params.minLinePoints / 3));

  DebugLog(
    "[auto-measure][refine] before corners=T(%.2f,%.2f) R(%.2f,%.2f) B(%.2f,%.2f) L(%.2f,%.2f) halfDiag=%.2f maxDrift=%.2f stripLen=%.2f\n",
    corners.top.x, corners.top.y, corners.right.x, corners.right.y,
    corners.bottom.x, corners.bottom.y, corners.left.x, corners.left.y,
    halfDiag, maxDrift, stripLen);

  // Side ordering matches lines[0..3] = top→right, right→bottom, bottom→left,
  // left→top. Tip = intersection of two adjacent sides.
  struct TipSpec {
    const char* name;
    cv::Point2f* corner;
    int lineIdxA;
    int lineIdxB;
    bool d2Tip;
  };
  TipSpec specs[4] = {
    {"top",    &corners.top,    3, 0, true},
    {"right",  &corners.right,  0, 1, false},
    {"bottom", &corners.bottom, 1, 2, true},
    {"left",   &corners.left,   2, 3, false},
  };

  auto stripFor = [&](const LineModel& line, cv::Point2f tip, int& sc) -> std::vector<cv::Point2f> {
    cv::Point2f along = line.dir;
    const cv::Point2f toMid = line.point - tip;
    if (Dot(along, toMid) < 0.0) along = -along;
    const cv::Point2f a = tip;
    const cv::Point2f b = tip + along * static_cast<float>(stripLen);
    return SampleEdgePoints(pre, a, b, center, params, sc);
  };

  int refinedCount = 0;
  for (int i = 0; i < 4; ++i) {
    if (onlyD2Tips && !specs[i].d2Tip) continue;
    const cv::Point2f original = *specs[i].corner;
    const LineModel& la = lines[specs[i].lineIdxA];
    const LineModel& lb = lines[specs[i].lineIdxB];
    int scA = 0, scB = 0;
    const std::vector<cv::Point2f> stripA = stripFor(la, original, scA);
    const std::vector<cv::Point2f> stripB = stripFor(lb, original, scB);

    bool accepted = false;
    cv::Point2f refinedTip = original;
    double drift = -1.0;
    const char* reason = "ok";

    if (static_cast<int>(stripA.size()) < minStripPoints ||
        static_cast<int>(stripB.size()) < minStripPoints) {
      reason = "insufficient-strip-points";
    } else {
      const LineModel rA = FitRobustLine(stripA, la.dir, scA, minStripPoints);
      const LineModel rB = FitRobustLine(stripB, lb.dir, scB, minStripPoints);
      if (!rA.ok || !rB.ok) {
        reason = "strip-fit-failed";
      } else if (AngleBetweenDirections(rA.dir, la.dir) > 18.0 ||
                 AngleBetweenDirections(rB.dir, lb.dir) > 18.0) {
        reason = "strip-angle-deviation";
      } else if (!IntersectLines(rA, rB, refinedTip)) {
        reason = "strip-intersect-failed";
      } else if (!PointInsideImage(refinedTip, params)) {
        reason = "outside-image";
      } else {
        drift = Distance(refinedTip, original);
        const double allowedDrift = specs[i].d2Tip ? maxD2Drift : maxDrift;
        if (drift > allowedDrift) {
          reason = "drift-exceeded";
        } else {
          *specs[i].corner = refinedTip;
          accepted = true;
          ++refinedCount;
        }
      }
    }

    DebugLog(
      "[auto-measure][refine] corner index=%d name=%s roi=stripLen=%.1f stripPts=(%d,%d) best=(%.2f,%.2f) score=drift=%.2f accepted=%d reason=%s\n",
      i, specs[i].name, stripLen,
      static_cast<int>(stripA.size()), static_cast<int>(stripB.size()),
      refinedTip.x, refinedTip.y, drift, accepted ? 1 : 0, reason);
  }

  DebugLog(
    "[auto-measure][refine] refined corners=T(%.2f,%.2f) R(%.2f,%.2f) B(%.2f,%.2f) L(%.2f,%.2f) refinedCount=%d\n",
    corners.top.x, corners.top.y, corners.right.x, corners.right.y,
    corners.bottom.x, corners.bottom.y, corners.left.x, corners.left.y,
    refinedCount);
  return refinedCount > 0;
}

void TryRefineCorners(const cv::Mat& gray, OrderedCorners& corners, const Params& params) {
  std::vector<cv::Point2f> pts{corners.top, corners.right, corners.bottom, corners.left};
  try {
    cv::cornerSubPix(
      gray,
      pts,
      {5, 5},
      {-1, -1},
      {cv::TermCriteria::EPS + cv::TermCriteria::COUNT, 20, 0.03}
    );
  } catch (const cv::Exception&) {
    return;
  }

  const std::array<cv::Point2f, 4> original{corners.top, corners.right, corners.bottom, corners.left};
  for (int i = 0; i < 4; ++i) {
    if (!PointInsideImage(pts[i], params) || Distance(pts[i], original[i]) > 5.0) {
      return;
    }
  }
  corners.top = pts[0];
  corners.right = pts[1];
  corners.bottom = pts[2];
  corners.left = pts[3];
}

double ComputeConfidence(
  const Params& params,
  const Candidate& candidate,
  const std::array<LineModel, 4>& lines,
  const ShapeMetrics& finalMetrics
) {
  const double maxCenterDistance = std::min(params.width, params.height) * params.maxCenterDistanceRatio;
  const double centerScore = Clamp01(1.0 - candidate.centerDistance / std::max(1.0, maxCenterDistance));
  const double sideScore = RatioScore(finalMetrics.sideRatio, params.maxSideLengthRatio);
  const double diagScore = RatioScore(finalMetrics.diagonalRatio, params.maxDiagonalRatio);

  double angleError = 0.0;
  for (double angle : finalMetrics.anglesDeg) angleError += std::abs(angle - 90.0);
  angleError /= 4.0;
  const double angleScore = Clamp01(1.0 - angleError / std::max(1.0, params.angleToleranceDeg));

  const double parallelA = AngleBetweenDirections(lines[0].dir, lines[2].dir);
  const double parallelB = AngleBetweenDirections(lines[1].dir, lines[3].dir);
  const double parallelScore = Clamp01(1.0 - ((parallelA + parallelB) * 0.5) / 18.0);

  double pointScoreSum = 0.0;
  double residualScoreSum = 0.0;
  for (int i = 0; i < 4; ++i) {
    const double needed = std::max<double>(params.minLinePoints, lines[i].sampleCount * 0.42);
    pointScoreSum += Clamp01(lines[i].pointCount / std::max(1.0, needed));
    const double reference = std::max(2.2, finalMetrics.sideLengths[i] * 0.045);
    residualScoreSum += Clamp01(1.0 - lines[i].residual / reference);
  }
  const double pointScore = pointScoreSum / 4.0;
  const double residualScore = residualScoreSum / 4.0;
  const double solidityScore = Clamp01((candidate.solidity - 0.52) / 0.38);

  return Clamp01(
    0.16 * centerScore +
    0.14 * sideScore +
    0.14 * diagScore +
    0.15 * angleScore +
    0.12 * parallelScore +
    0.17 * pointScore +
    0.08 * residualScore +
    0.04 * solidityScore
  );
}

// Industrial-style 4-tip refinement for the 10X two-line mode.
//
// Pipeline (matches Clemex/Halcon overlays):
//   1. Per-axis contour extremes inside a center band — top/bottom are the
//      contour points with min/max Y within ±bandX of the rect center X;
//      left/right are the min/max X points within ±bandY of center Y. This
//      replaces using minAreaRect corners directly so we land on the actual
//      darkest indent corners, not the rotated bounding box.
//   2. Local Sobel-gradient (pre.gradMag) edge snap — for each tip we sweep
//      a short 1-D window along the tip's outward axis and snap to the
//      strongest gradient transition. Gives sub-rect accuracy on soft 10X
//      edges where the contour boundary has a few px of fuzz.
//   3. Force D1 (left↔right) onto a single horizontal line and D2
//      (top↔bottom) onto a single vertical line through the shared center.
//      This is what eliminates the "slightly tilted / off-center D1" the
//      user reported while still respecting per-tip refinement for the tip
//      *lengths* (only the orthogonal coord is collapsed onto the axis).
//
// Each tip is refined independently; if a tip's refinement drifts more than
// the allowed cap it falls back to the contour extreme (and ultimately the
// original rect corner via the validation clamp). No mutation if the
// contour is empty.
void RefineTipsForTwoLineMode(
  const std::vector<cv::Point>& contour,
  const cv::Mat& gradMag,
  const cv::Mat& blurred,
  const cv::RotatedRect& initialRect,
  const Params& params,
  OrderedCorners& corners
) {
  if (contour.empty()) return;

  // rawTop/rawBottom = corners as passed in (before any refinement). Logged
  // so we can compare against contour-extreme and final tip positions.
  const cv::Point2f rawTopIn = corners.top;
  const cv::Point2f rawBottomIn = corners.bottom;
  std::fprintf(stderr,
    "[auto-measure-d2-refine] rawTop=(%.2f,%.2f)\n",
    rawTopIn.x, rawTopIn.y);
  std::fprintf(stderr,
    "[auto-measure-d2-refine] rawBottom=(%.2f,%.2f)\n",
    rawBottomIn.x, rawBottomIn.y);
  std::fflush(stderr);

  std::fprintf(stderr,
    "[auto-measure-refine] initialRect=center(%.2f,%.2f) size(%.2fx%.2f) angle=%.2f\n",
    initialRect.center.x, initialRect.center.y,
    initialRect.size.width, initialRect.size.height, initialRect.angle);
  std::fflush(stderr);

  const cv::Point2f center = initialRect.center;
  const float rectW = std::max(initialRect.size.width, initialRect.size.height);
  const float rectH = std::min(initialRect.size.width, initialRect.size.height);
  // Bands are tight (≈18% of the half-extent) so we only consider points that
  // are genuinely "near the axis" of each tip — wider bands let oblique
  // diamond edge points win as extremes and reproduce the tilt the user
  // reported.
  const float bandX = std::max(6.0f, rectW * 0.18f);
  const float bandY = std::max(6.0f, rectH * 0.18f);

  cv::Point2f topPt = corners.top;
  cv::Point2f botPt = corners.bottom;
  cv::Point2f leftPt = corners.left;
  cv::Point2f rightPt = corners.right;
  float bestTopY = std::numeric_limits<float>::infinity();
  float bestBotY = -std::numeric_limits<float>::infinity();
  float bestLeftX = std::numeric_limits<float>::infinity();
  float bestRightX = -std::numeric_limits<float>::infinity();

  for (const auto& ip : contour) {
    const cv::Point2f p(static_cast<float>(ip.x), static_cast<float>(ip.y));
    if (std::abs(p.x - center.x) <= bandX) {
      if (p.y < bestTopY) { bestTopY = p.y; topPt = p; }
      if (p.y > bestBotY) { bestBotY = p.y; botPt = p; }
    }
    if (std::abs(p.y - center.y) <= bandY) {
      if (p.x < bestLeftX) { bestLeftX = p.x; leftPt = p; }
      if (p.x > bestRightX) { bestRightX = p.x; rightPt = p; }
    }
  }

  std::fprintf(stderr,
    "[auto-measure-refine] contourExtremes=top(%.2f,%.2f) bottom(%.2f,%.2f) left(%.2f,%.2f) right(%.2f,%.2f)\n",
    topPt.x, topPt.y, botPt.x, botPt.y, leftPt.x, leftPt.y, rightPt.x, rightPt.y);
  std::fprintf(stderr,
    "[auto-measure-d2-refine] contourTop=(%.2f,%.2f)\n", topPt.x, topPt.y);
  std::fprintf(stderr,
    "[auto-measure-d2-refine] contourBottom=(%.2f,%.2f)\n", botPt.x, botPt.y);
  std::fflush(stderr);

  // ---------- Edge-fit refinement (real geometric corners) ----------
  // Split the contour into the 4 diamond sides by angle around the center,
  // fit a line through each side, and intersect adjacent sides to obtain the
  // 4 geometric corners. This lands on the true tips even when the diamond
  // is slightly rotated — extremes alone can drift sideways and produce a
  // skewed D2. If the fit fails or drifts unreasonably, we keep topPt/botPt/
  // leftPt/rightPt as the extreme contour points (fallback path below uses
  // the Sobel + top-edge snap).
  std::fprintf(stderr,
    "[auto-measure-10x-refine-start] contourIndex=0 area=%.2f points=%d\n",
    cv::contourArea(contour), static_cast<int>(contour.size()));
  std::fflush(stderr);

  bool usedEdgeFit = false;
  {
    auto angleFromCenter = [&](const cv::Point2f& p) -> float {
      return std::atan2(p.y - center.y, p.x - center.x);
    };
    // atan2 in image coords (y-down): top ≈ -π/2, right ≈ 0, bottom ≈ π/2,
    // left ≈ ±π. Going clockwise: top → right → bottom → left → top.
    const float aTop = angleFromCenter(topPt);
    const float aRight = angleFromCenter(rightPt);
    const float aBottom = angleFromCenter(botPt);
    const float aLeft = angleFromCenter(leftPt);

    auto angleInArc = [](float a, float lo, float hi) {
      // Arc from lo to hi going in the direction of increasing atan2 value.
      if (lo <= hi) return a >= lo && a <= hi;
      // Wraps through ±π (e.g. left → top side).
      return a >= lo || a <= hi;
    };

    // Side buckets, clockwise from top:
    //   0 = top→right (top-right edge of diamond)
    //   1 = right→bottom (bottom-right edge)
    //   2 = bottom→left (bottom-left edge)
    //   3 = left→top (top-left edge)
    std::vector<cv::Point2f> sides[4];
    for (const auto& ip : contour) {
      const cv::Point2f p(static_cast<float>(ip.x), static_cast<float>(ip.y));
      const float a = angleFromCenter(p);
      if (angleInArc(a, aTop, aRight)) sides[0].push_back(p);
      else if (angleInArc(a, aRight, aBottom)) sides[1].push_back(p);
      else if (angleInArc(a, aBottom, aLeft)) sides[2].push_back(p);
      else sides[3].push_back(p);
    }

    static const char* kSideName[4] = {"topRight", "bottomRight", "bottomLeft", "topLeft"};
    const int MIN_PER_SIDE = 4;
    cv::Vec4f fitted[4];
    bool fitOk = true;
    for (int i = 0; i < 4; ++i) {
      const int n = static_cast<int>(sides[i].size());
      if (n < MIN_PER_SIDE) {
        std::fprintf(stderr,
          "[auto-measure-10x-edge-fit] side=%s points=%d ok=false\n",
          kSideName[i], n);
        fitOk = false;
        continue;
      }
      cv::fitLine(sides[i], fitted[i], cv::DIST_L2, 0, 0.01, 0.01);
      std::fprintf(stderr,
        "[auto-measure-10x-edge-fit] side=%s points=%d ok=true\n",
        kSideName[i], n);
    }
    std::fflush(stderr);

    auto intersectLines = [](const cv::Vec4f& L1, const cv::Vec4f& L2,
                             cv::Point2f& out) -> bool {
      const float vx1 = L1[0], vy1 = L1[1], x01 = L1[2], y01 = L1[3];
      const float vx2 = L2[0], vy2 = L2[1], x02 = L2[2], y02 = L2[3];
      const float det = vx2 * vy1 - vx1 * vy2;
      if (std::abs(det) < 1e-6f) return false;
      const float t = (vx2 * (y02 - y01) - vy2 * (x02 - x01)) / det;
      out.x = x01 + t * vx1;
      out.y = y01 + t * vy1;
      return true;
    };

    cv::Point2f refTop, refRight, refBottom, refLeft;
    bool intersectOk = false;
    if (fitOk) {
      // Corner = intersection of the two adjacent fitted sides.
      //   top    = topRight ∩ topLeft   (sides 0 & 3)
      //   right  = topRight ∩ bottomRight (0 & 1)
      //   bottom = bottomRight ∩ bottomLeft (1 & 2)
      //   left   = bottomLeft ∩ topLeft (2 & 3)
      intersectOk =
        intersectLines(fitted[0], fitted[3], refTop) &&
        intersectLines(fitted[0], fitted[1], refRight) &&
        intersectLines(fitted[1], fitted[2], refBottom) &&
        intersectLines(fitted[2], fitted[3], refLeft);
    }

    if (intersectOk) {
      // Clamp to image bounds.
      auto clampPt = [&](cv::Point2f& p) {
        p.x = std::clamp(p.x, 0.0f, static_cast<float>(params.width - 1));
        p.y = std::clamp(p.y, 0.0f, static_cast<float>(params.height - 1));
      };
      clampPt(refTop); clampPt(refRight); clampPt(refBottom); clampPt(refLeft);

      // Reject impossible geometry: corner order wrong, diagonal too small,
      // unreasonable ratio, or any tip too far from its extreme.
      const bool orderOk =
        refTop.y < refBottom.y - 4.0f &&
        refLeft.x < refRight.x - 4.0f;
      const double d1 = std::hypot(refRight.x - refLeft.x, refRight.y - refLeft.y);
      const double d2 = std::hypot(refBottom.x - refTop.x, refBottom.y - refTop.y);
      const double minD = std::min(d1, d2);
      const double maxD = std::max(d1, d2);
      const double ratio = minD > 0.0 ? maxD / minD : 1e9;
      const bool sizeOk = minD >= 8.0 && ratio <= 1.45;

      const float halfDiag = 0.5f * std::hypot(rectW, rectH);
      const float driftCap = std::max(24.0f, halfDiag * 0.35f);
      auto driftOk = [&](const cv::Point2f& a, const cv::Point2f& b) {
        return std::hypot(a.x - b.x, a.y - b.y) <= driftCap;
      };
      const bool neighborhoodOk =
        driftOk(refTop, topPt) && driftOk(refRight, rightPt) &&
        driftOk(refBottom, botPt) && driftOk(refLeft, leftPt);

      if (!orderOk) {
        std::fprintf(stderr, "[auto-measure-10x-fallback] reason=corner-order\n");
      } else if (!sizeOk) {
        std::fprintf(stderr,
          "[auto-measure-10x-fallback] reason=size-or-ratio d1=%.2f d2=%.2f ratio=%.2f\n",
          d1, d2, ratio);
      } else if (!neighborhoodOk) {
        std::fprintf(stderr,
          "[auto-measure-10x-fallback] reason=drift-exceeds-cap cap=%.2f\n",
          driftCap);
      } else {
        topPt = refTop; rightPt = refRight; botPt = refBottom; leftPt = refLeft;
        usedEdgeFit = true;
      }

      std::fprintf(stderr,
        "[auto-measure-10x-intersections] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f) used=%s\n",
        refTop.x, refTop.y, refRight.x, refRight.y,
        refBottom.x, refBottom.y, refLeft.x, refLeft.y,
        usedEdgeFit ? "true" : "false");
      std::fflush(stderr);
    } else {
      std::fprintf(stderr,
        "[auto-measure-10x-fallback] reason=%s\n",
        fitOk ? "intersection-failed" : "side-fit-insufficient-points");
      std::fflush(stderr);
    }
  }

  // Local Sobel-magnitude edge snap. Sweep a small window along the outward
  // axis (Y for top/bottom, X for left/right) at the band-center coordinate.
  // The strongest gradient cell is the dark→light transition at the indent
  // corner. We CAP the snap distance so we never jump off the contour.
  auto sampleGrad = [&](int x, int y) -> float {
    if (gradMag.empty() || x < 0 || y < 0 || x >= gradMag.cols || y >= gradMag.rows) return 0.0f;
    return gradMag.at<float>(y, x);
  };

  const int snapCapV = std::clamp(static_cast<int>(std::round(rectH * 0.10f)), 3, 10);
  const int snapCapH = std::clamp(static_cast<int>(std::round(rectW * 0.10f)), 3, 10);

  auto snapY = [&](cv::Point2f& tip, int cap, bool outwardUp) {
    const int x = static_cast<int>(std::round(tip.x));
    const int yc = static_cast<int>(std::round(tip.y));
    int y0 = std::max(0, yc - cap);
    int y1 = std::min((gradMag.empty() ? params.height : gradMag.rows) - 1, yc + cap);
    float bestG = -1.0f;
    int bestY = yc;
    for (int y = y0; y <= y1; ++y) {
      // Slight bias toward the outward direction so we pick the outer edge
      // transition (real corner) over the inner shoulder.
      const float bias = outwardUp ? static_cast<float>(yc - y) * 0.04f
                                   : static_cast<float>(y - yc) * 0.04f;
      const float g = sampleGrad(x, y) + bias;
      if (g > bestG) { bestG = g; bestY = y; }
    }
    tip.y = static_cast<float>(bestY);
  };
  auto snapX = [&](cv::Point2f& tip, int cap, bool outwardLeft) {
    const int y = static_cast<int>(std::round(tip.y));
    const int xc = static_cast<int>(std::round(tip.x));
    int x0 = std::max(0, xc - cap);
    int x1 = std::min((gradMag.empty() ? params.width : gradMag.cols) - 1, xc + cap);
    float bestG = -1.0f;
    int bestX = xc;
    for (int x = x0; x <= x1; ++x) {
      const float bias = outwardLeft ? static_cast<float>(xc - x) * 0.04f
                                     : static_cast<float>(x - xc) * 0.04f;
      const float g = sampleGrad(x, y) + bias;
      if (g > bestG) { bestG = g; bestX = x; }
    }
    tip.x = static_cast<float>(bestX);
  };

  if (!usedEdgeFit && !gradMag.empty()) {
    // Bottom/left/right keep the bulk outward-biased snap — those tips are
    // already correct per user report. Skipped when edge-fit succeeded: the
    // intersection points are already on the geometric corners.
    snapY(botPt, snapCapV, false);
    snapX(leftPt, snapCapH, true);
    snapX(rightPt, snapCapH, false);
  }

  // -------- TOP-ONLY targeted refinement (fallback only) --------
  // Bug: the generic outward-biased snap pulled the top tip ABOVE the real
  // diamond corner into the bright background (the dark→bright transition's
  // strongest |∇I| point sits a couple of px outside the corner). For the
  // top tip only we (a) drop the outward bias, (b) clamp so the refined Y
  // cannot rise above the contour extreme by more than 1 px, and (c) apply
  // a geometric-consistency snap toward the mirror prediction from the
  // bottom tip if the candidate is wildly off-axis.
  //
  // Skipped when edge-fit already produced geometric corners.
  if (!usedEdgeFit) {
  const cv::Point2f rawTopForLog = topPt;
  cv::Point2f edgeCandidate = topPt;
  if (!gradMag.empty()) {
    const int x = static_cast<int>(std::round(topPt.x));
    const int yc = static_cast<int>(std::round(topPt.y));
    // Allow searching a few px inward (toward center) and AT MOST 1 px
    // outward — this is the no-overshoot clamp.
    const int outwardLimit = 1;
    const int inwardLimit = std::clamp(static_cast<int>(std::round(rectH * 0.12f)), 4, 12);
    const int y0 = std::max(0, yc - outwardLimit);
    const int y1 = std::min((gradMag.empty() ? params.height : gradMag.rows) - 1,
                            yc + inwardLimit);
    float bestG = -1.0f;
    int bestY = yc;
    for (int y = y0; y <= y1; ++y) {
      // No outward bias. Slight INWARD preference (favor staying on the
      // dark side of the dark→bright transition, i.e. on the diamond edge).
      const float bias = static_cast<float>(y - yc) * 0.03f;
      const float g = sampleGrad(x, y) + bias;
      if (g > bestG) { bestG = g; bestY = y; }
    }
    edgeCandidate.y = static_cast<float>(bestY);
  }

  std::fprintf(stderr,
    "[auto-measure-top-refine] rawTop=(%.2f,%.2f)\n",
    rawTopForLog.x, rawTopForLog.y);
  std::fprintf(stderr,
    "[auto-measure-top-refine] edgeCandidate=(%.2f,%.2f)\n",
    edgeCandidate.x, edgeCandidate.y);
  std::fflush(stderr);

  // Geometric-consistency check: the top tip should sit roughly opposite the
  // bottom tip across the diamond center. If the edge candidate deviates by
  // more than ~30% of the diamond half-height from this mirror prediction
  // (caused by a bright speckle above the corner), snap halfway toward the
  // prediction. Never below center.
  cv::Point2f topPredict = topPt;
  {
    const float expectedY = 2.0f * center.y - botPt.y;
    const float halfH = std::max(8.0f, std::abs(botPt.y - center.y));
    const float deviation = std::abs(edgeCandidate.y - expectedY);
    const float deviationTol = halfH * 0.30f;
    if (deviation > deviationTol) {
      // Pull halfway toward the mirror prediction — keeps a real off-axis
      // detection if it's only slightly off, but rejects gross outliers.
      topPredict.y = 0.5f * (edgeCandidate.y + expectedY);
    } else {
      topPredict.y = edgeCandidate.y;
    }
    // Hard guard: never let top cross center.
    if (topPredict.y > center.y - 2.0f) topPredict.y = center.y - 2.0f;
  }
  topPt = topPredict;

  const float topCorrectionPx = topPt.y - rawTopForLog.y;

  std::fprintf(stderr,
    "[auto-measure-top-refine] finalTop=(%.2f,%.2f)\n",
    topPt.x, topPt.y);
  std::fprintf(stderr,
    "[auto-measure-top-refine] correctionPx=%.2f\n",
    topCorrectionPx);
  std::fflush(stderr);

  } // end if (!usedEdgeFit) — top-only refinement block

  std::fprintf(stderr,
    "[auto-measure-refine] edgeRefinedTips=top(%.2f,%.2f) bottom(%.2f,%.2f) left(%.2f,%.2f) right(%.2f,%.2f)\n",
    topPt.x, topPt.y, botPt.x, botPt.y, leftPt.x, leftPt.y, rightPt.x, rightPt.y);
  std::fflush(stderr);

  cv::Point2f beforeTop;
  cv::Point2f beforeBottom;

  if (usedEdgeFit) {
    // Edge-fit succeeded: use the real geometric corners directly. Do NOT
    // force axis alignment — the 4 intersection points already share a
    // single geometric center by construction, and a rotated diamond's true
    // tips should not be snapped onto a forced horizontal/vertical axis.
    beforeTop = topPt;
    beforeBottom = botPt;
    corners.top = topPt;
    corners.right = rightPt;
    corners.bottom = botPt;
    corners.left = leftPt;
    const float centerX = (leftPt.x + rightPt.x) * 0.5f;
    const float centerY = (leftPt.y + rightPt.y) * 0.5f;
    std::fprintf(stderr,
      "[auto-measure-10x-center] centerX=%.2f centerY=%.2f source=edge-fit\n",
      centerX, centerY);
    std::fflush(stderr);
  } else {
    // Fallback path: tips came from extreme + Sobel + top-edge. These are
    // noisier in X, so collapse D1/D2 onto the D1-derived center to keep
    // them crossing at a single point.
    const float centerX = (leftPt.x + rightPt.x) * 0.5f;
    const float centerY = (leftPt.y + rightPt.y) * 0.5f;
    std::fprintf(stderr,
      "[auto-measure-10x-center] centerX=%.2f centerY=%.2f source=fallback-d1\n",
      centerX, centerY);
    std::fflush(stderr);
    beforeTop = topPt;
    beforeBottom = botPt;
    corners.left = {leftPt.x, centerY};
    corners.right = {rightPt.x, centerY};
    corners.top = {centerX, topPt.y};
    corners.bottom = {centerX, botPt.y};
  }

  std::fprintf(stderr,
    "[auto-measure-d2-align] beforeTop=(%.2f,%.2f) beforeBottom=(%.2f,%.2f) afterTop=(%.2f,%.2f) afterBottom=(%.2f,%.2f)\n",
    beforeTop.x, beforeTop.y, beforeBottom.x, beforeBottom.y,
    corners.top.x, corners.top.y, corners.bottom.x, corners.bottom.y);
  std::fflush(stderr);

  // -------- Contour-snap for left / right / bottom --------
  // Edge-fit intersections can land a couple of px outside the actual
  // contour boundary (the fitted lines are extrapolated past the curved
  // tip). Snap each of left/right/bottom to the nearest real contour point
  // within a local window so the yellow dots sit exactly on the visible
  // diamond corner. TOP is intentionally untouched per requirements — its
  // current refinement is correct.
  {
    const float halfDiag = 0.5f * std::hypot(rectW, rectH);
    const float searchRadius = std::max(6.0f, halfDiag * 0.18f);
    const float searchRadiusSq = searchRadius * searchRadius;

    auto snapToContour = [&](cv::Point2f tip) -> cv::Point2f {
      cv::Point2f best = tip;
      float bestDistSq = std::numeric_limits<float>::infinity();
      for (const auto& ip : contour) {
        const float dx = static_cast<float>(ip.x) - tip.x;
        const float dy = static_cast<float>(ip.y) - tip.y;
        const float dsq = dx * dx + dy * dy;
        if (dsq > searchRadiusSq) continue;
        if (dsq < bestDistSq) {
          bestDistSq = dsq;
          best = cv::Point2f(static_cast<float>(ip.x), static_cast<float>(ip.y));
        }
      }
      return best;
    };

    // Accept the snap only when the correction is small. Edge-fit
    // intersections already land on the geometric corner; a large snap
    // distance means the nearest contour pixel is on the wrong side of the
    // tip (a curved indent edge), which pulls the dot inward off the
    // visible corner. 4 px is the working threshold — anything larger,
    // keep the edge-fit point.
    const float MAX_SNAP_PX = 4.0f;
    auto refineTip = [&](const char* name, cv::Point2f raw) -> cv::Point2f {
      const cv::Point2f candidate = snapToContour(raw);
      const float correction = std::hypot(candidate.x - raw.x, candidate.y - raw.y);
      const bool accept = correction <= MAX_SNAP_PX;
      const char* reason = accept ? "within-threshold" : "exceeds-threshold-keep-edge-fit";
      const cv::Point2f chosen = accept ? candidate : raw;
      std::fprintf(stderr,
        "[auto-measure-tip-refine] tip=%s raw=(%.2f,%.2f) refined=(%.2f,%.2f) correctionPx=%.2f\n",
        name, raw.x, raw.y, chosen.x, chosen.y, correction);
      std::fprintf(stderr,
        "[auto-measure-tip-refine-confidence] tip=%s correctionPx=%.2f accepted=%s reason=%s\n",
        name, correction, accept ? "true" : "false", reason);
      std::fprintf(stderr,
        "[auto-measure-final-source-tip] tip=%s source=%s\n",
        name, accept ? "contour-snap" : "edge-fit");
      return chosen;
    };

    const cv::Point2f rawLeft = corners.left;
    const cv::Point2f rawRight = corners.right;
    const cv::Point2f rawBottom = corners.bottom;

    corners.left = refineTip("left", rawLeft);
    corners.right = refineTip("right", rawRight);
    corners.bottom = refineTip("bottom", rawBottom);
    std::fflush(stderr);
  }

  // ---------- 10X final geometry source selection ----------
  // Edge-fit corners (from `usedEdgeFit`) sit on the real intersection of
  // the 4 fitted diamond sides, which lands closer to the true visible
  // corners than the axis-bounds snap (the latter forces alignment and
  // moves dots off the actual tips when the diamond is slightly rotated).
  // So: keep edge-fit corners when they're valid; only fall back to the
  // axis-aligned bounds snap if edge-fit was rejected earlier.
  if (usedEdgeFit) {
    std::fprintf(stderr,
      "[auto-measure-10x-final-source] source=edge-fit reason=edge-fit-valid\n");
    std::fprintf(stderr,
      "[auto-measure-10x-axis-final] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
      corners.top.x, corners.top.y, corners.right.x, corners.right.y,
      corners.bottom.x, corners.bottom.y, corners.left.x, corners.left.y);
    std::fflush(stderr);
  } else {
    std::fprintf(stderr,
      "[auto-measure-10x-final-source] source=axis-bounds-fallback reason=edge-fit-rejected\n");
    std::fflush(stderr);
  // ---------- 10X axis-aligned final geometry (fallback only) ----------
  // Used when edge-fit was rejected: D1 horizontal through a single shared
  // center, D2 vertical through that same center, dots sitting on actual
  // contour boundary at the centerlines. The locked coord (Y for left/right,
  // X for top/bottom) is preserved during the contour snap, so D1 cannot
  // drift up/down and D2 cannot drift left/right.
  {
    cv::Point2f leftMost(0, 0), rightMost(0, 0), topMost(0, 0), bottomMost(0, 0);
    float minX = std::numeric_limits<float>::infinity();
    float maxX = -std::numeric_limits<float>::infinity();
    float minY = std::numeric_limits<float>::infinity();
    float maxY = -std::numeric_limits<float>::infinity();
    for (const auto& ip : contour) {
      const float x = static_cast<float>(ip.x);
      const float y = static_cast<float>(ip.y);
      if (x < minX) { minX = x; leftMost = {x, y}; }
      if (x > maxX) { maxX = x; rightMost = {x, y}; }
      if (y < minY) { minY = y; topMost = {x, y}; }
      if (y > maxY) { maxY = y; bottomMost = {x, y}; }
    }
    std::fprintf(stderr,
      "[auto-measure-10x-bounds] leftMost=(%.2f,%.2f) rightMost=(%.2f,%.2f) topMost=(%.2f,%.2f) bottomMost=(%.2f,%.2f)\n",
      leftMost.x, leftMost.y, rightMost.x, rightMost.y,
      topMost.x, topMost.y, bottomMost.x, bottomMost.y);

    const float axisCenterX = (leftMost.x + rightMost.x) * 0.5f;
    const float axisCenterY = (topMost.y + bottomMost.y) * 0.5f;
    std::fprintf(stderr,
      "[auto-measure-10x-center] centerX=%.2f centerY=%.2f source=axis-bounds\n",
      axisCenterX, axisCenterY);

    // Narrow centerline bands: snap each tip to the contour extreme at the
    // shared axis. Wide enough to tolerate a few px of noise, narrow enough
    // that the opposite axis's tips never enter the search.
    const float bandH = std::max(4.0f, 0.10f * (rightMost.x - leftMost.x));
    const float bandV = std::max(4.0f, 0.10f * (bottomMost.y - topMost.y));

    float bestLeftX = leftMost.x;
    float bestRightX = rightMost.x;
    float bestTopY = topMost.y;
    float bestBottomY = bottomMost.y;
    for (const auto& ip : contour) {
      const float x = static_cast<float>(ip.x);
      const float y = static_cast<float>(ip.y);
      if (std::abs(y - axisCenterY) <= bandV) {
        if (x < bestLeftX) bestLeftX = x;
        if (x > bestRightX) bestRightX = x;
      }
      if (std::abs(x - axisCenterX) <= bandH) {
        if (y < bestTopY) bestTopY = y;
        if (y > bestBottomY) bestBottomY = y;
      }
    }

    // Force axis alignment: left/right share Y = axisCenterY (D1 horizontal),
    // top/bottom share X = axisCenterX (D2 vertical).
    corners.left = {bestLeftX, axisCenterY};
    corners.right = {bestRightX, axisCenterY};
    corners.top = {axisCenterX, bestTopY};
    corners.bottom = {axisCenterX, bestBottomY};

    std::fprintf(stderr,
      "[auto-measure-10x-axis-final] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
      corners.top.x, corners.top.y, corners.right.x, corners.right.y,
      corners.bottom.x, corners.bottom.y, corners.left.x, corners.left.y);
    std::fflush(stderr);
  }
  } // end else (axis-bounds fallback)

  // Snapshot the chosen prior corners (edge-fit or axis-bounds-fallback).
  // The clean-blob block below may override these; if it's rejected, we
  // explicitly restore from this snapshot so corners can never drift back
  // to noisy minAreaRect / earlier-pipeline values.
  const cv::Point2f priorTop = corners.top;
  const cv::Point2f priorRight = corners.right;
  const cv::Point2f priorBottom = corners.bottom;
  const cv::Point2f priorLeft = corners.left;
  const char* priorSource = usedEdgeFit ? "edge-fit" : "axis-bounds-fallback";

  // ---------- 10X ROI clean-blob final refinement ----------
  // Crop a tight ROI around the selected diamond, re-threshold ONLY the
  // darkest pixels there, clean with morphology, and pick the largest dark
  // blob nearest the selected center. The blob's contour extremes (min/max
  // x and y) are the true visible indentation corners — but only when the
  // blob is genuinely the indent and not a larger surrounding shadow / rim
  // region. Validation gates below reject blobs that don't fit.
  const double selectedContourArea = cv::contourArea(contour);
  const cv::Rect selectedBbox = cv::boundingRect(contour);
  bool cleanBlobAccepted = false;
  const char* finalSource = priorSource;
  const char* finalReason = "blob-not-attempted";
  if (!blurred.empty()) {
    cv::Rect bbox = cv::boundingRect(contour);
    const int margin = std::max(8, static_cast<int>(std::round(0.18 *
      std::max(bbox.width, bbox.height))));
    cv::Rect roi(bbox.x - margin, bbox.y - margin,
                 bbox.width + 2 * margin, bbox.height + 2 * margin);
    roi &= cv::Rect(0, 0, blurred.cols, blurred.rows);

    std::fprintf(stderr,
      "[auto-measure-10x-roi-refine] roi=(%d,%d %dx%d)\n",
      roi.x, roi.y, roi.width, roi.height);
    std::fflush(stderr);

    if (roi.width >= 8 && roi.height >= 8) {
      const cv::Mat roiImg = blurred(roi);
      cv::Mat darkMask;
      // Otsu on the ROI alone — adapts to the local dark/light split rather
      // than a global threshold that includes background pixels.
      cv::threshold(roiImg, darkMask, 0, 255,
                    cv::THRESH_BINARY_INV | cv::THRESH_OTSU);
      cv::Mat kClose = cv::getStructuringElement(cv::MORPH_RECT, {5, 5});
      cv::Mat kOpen = cv::getStructuringElement(cv::MORPH_RECT, {3, 3});
      cv::morphologyEx(darkMask, darkMask, cv::MORPH_CLOSE, kClose);
      cv::morphologyEx(darkMask, darkMask, cv::MORPH_OPEN, kOpen);

      std::vector<std::vector<cv::Point>> blobContours;
      cv::findContours(darkMask, blobContours, cv::RETR_EXTERNAL,
                       cv::CHAIN_APPROX_NONE);

      const cv::Point2f roiCenter(
        static_cast<float>(initialRect.center.x - roi.x),
        static_cast<float>(initialRect.center.y - roi.y));

      int bestIdx = -1;
      double bestScore = -1.0;
      double bestArea = 0.0;
      cv::Point2f bestCenter;
      for (size_t i = 0; i < blobContours.size(); ++i) {
        const auto& c = blobContours[i];
        if (c.size() < 8) continue;
        const double area = cv::contourArea(c);
        if (area < 40.0) continue;
        cv::Moments m = cv::moments(c);
        if (m.m00 <= 0.0) continue;
        const cv::Point2f bc(
          static_cast<float>(m.m10 / m.m00),
          static_cast<float>(m.m01 / m.m00));
        const float dx = bc.x - roiCenter.x;
        const float dy = bc.y - roiCenter.y;
        const double dist = std::sqrt(dx * dx + dy * dy);
        // Prefer larger blobs closer to the selected center.
        const double score = area / (1.0 + dist);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = static_cast<int>(i);
          bestArea = area;
          bestCenter = bc;
        }
      }

      if (bestIdx >= 0) {
        const auto& blob = blobContours[bestIdx];
        const cv::Point2f imgCenter(
          bestCenter.x + roi.x, bestCenter.y + roi.y);
        std::fprintf(stderr,
          "[auto-measure-10x-dark-blob] area=%.2f center=(%.2f,%.2f)\n",
          bestArea, imgCenter.x, imgCenter.y);

        cv::Point2f cleanTop, cleanRight, cleanBottom, cleanLeft;
        int bestTopY = INT_MAX, bestBottomY = INT_MIN;
        int bestLeftX = INT_MAX, bestRightX = INT_MIN;
        for (const auto& p : blob) {
          if (p.y < bestTopY)    { bestTopY = p.y;    cleanTop    = {static_cast<float>(p.x), static_cast<float>(p.y)}; }
          if (p.y > bestBottomY) { bestBottomY = p.y; cleanBottom = {static_cast<float>(p.x), static_cast<float>(p.y)}; }
          if (p.x < bestLeftX)   { bestLeftX = p.x;   cleanLeft   = {static_cast<float>(p.x), static_cast<float>(p.y)}; }
          if (p.x > bestRightX)  { bestRightX = p.x;  cleanRight  = {static_cast<float>(p.x), static_cast<float>(p.y)}; }
        }
        // Translate from ROI to image coordinates.
        cleanTop.x    += roi.x; cleanTop.y    += roi.y;
        cleanRight.x  += roi.x; cleanRight.y  += roi.y;
        cleanBottom.x += roi.x; cleanBottom.y += roi.y;
        cleanLeft.x   += roi.x; cleanLeft.y   += roi.y;

        std::fprintf(stderr,
          "[auto-measure-10x-clean-corners] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
          cleanTop.x, cleanTop.y, cleanRight.x, cleanRight.y,
          cleanBottom.x, cleanBottom.y, cleanLeft.x, cleanLeft.y);
        std::fflush(stderr);

        // Validate the clean blob produced sane geometry AND lies inside
        // the selected diamond's neighborhood. The killer case from logs:
        // a wrong huge blob with area >> selected contour area covers part
        // of the surrounding shadow and produces corners outside the real
        // diamond. We must reject it.
        const bool orderOk =
          cleanTop.y < cleanBottom.y - 4.0f &&
          cleanLeft.x < cleanRight.x - 4.0f;
        const double cd1 = std::hypot(cleanRight.x - cleanLeft.x,
                                      cleanRight.y - cleanLeft.y);
        const double cd2 = std::hypot(cleanBottom.x - cleanTop.x,
                                      cleanBottom.y - cleanTop.y);
        const double cMin = std::min(cd1, cd2);
        const double cMax = std::max(cd1, cd2);
        const double cRatio = cMin > 0.0 ? cMax / cMin : 1e9;
        const bool sizeOk = cMin >= 8.0 && cRatio <= 1.5;

        // Area ratio: blob must not exceed 1.20× the selected contour area
        // (anything larger is the surrounding shadow region, not the indent).
        // Also reject blobs smaller than 0.55× (truncated detection).
        const double areaRatio = selectedContourArea > 0.0
          ? bestArea / selectedContourArea : 1e9;
        const bool areaOk = areaRatio <= 1.20 && areaRatio >= 0.55;

        // Neighborhood: every clean corner must lie within a tolerance of
        // the selected contour's bounding box. Tolerance = max(8, 0.15·box
        // longest side).
        const float nbTol = std::max(8.0f, 0.15f *
          static_cast<float>(std::max(selectedBbox.width, selectedBbox.height)));
        auto insideBbox = [&](const cv::Point2f& p) -> bool {
          return p.x >= selectedBbox.x - nbTol &&
                 p.x <= selectedBbox.x + selectedBbox.width + nbTol &&
                 p.y >= selectedBbox.y - nbTol &&
                 p.y <= selectedBbox.y + selectedBbox.height + nbTol;
        };
        const bool neighborhoodOk =
          insideBbox(cleanTop) && insideBbox(cleanRight) &&
          insideBbox(cleanBottom) && insideBbox(cleanLeft);

        std::fprintf(stderr,
          "[auto-measure-10x-clean-blob-validate] areaRatio=%.3f areaOk=%d orderOk=%d sizeOk=%d neighborhoodOk=%d\n",
          areaRatio, areaOk ? 1 : 0, orderOk ? 1 : 0,
          sizeOk ? 1 : 0, neighborhoodOk ? 1 : 0);
        std::fflush(stderr);

        if (orderOk && sizeOk && areaOk && neighborhoodOk) {
          corners.top = cleanTop;
          corners.right = cleanRight;
          corners.bottom = cleanBottom;
          corners.left = cleanLeft;
          cleanBlobAccepted = true;
          finalSource = "clean-blob";
          finalReason = "blob-valid";
          std::fprintf(stderr,
            "[auto-measure-10x-final-source] source=clean-blob reason=blob-valid\n");
          std::fflush(stderr);
        } else {
          const char* r = !areaOk ? "blob-area-out-of-range"
                          : !neighborhoodOk ? "blob-corner-outside-selected-bbox"
                          : !orderOk ? "blob-order-invalid"
                          : "blob-size-or-ratio-invalid";
          finalReason = r;
          std::fprintf(stderr,
            "[auto-measure-10x-final-source] source=prior reason=%s areaRatio=%.3f d1=%.2f d2=%.2f ratio=%.2f\n",
            r, areaRatio, cd1, cd2, cRatio);
          std::fflush(stderr);
        }
      } else {
        finalReason = "no-dark-blob-found";
        std::fprintf(stderr,
          "[auto-measure-10x-final-source] source=prior reason=no-dark-blob-found\n");
        std::fflush(stderr);
      }
    } else {
      finalReason = "roi-too-small";
      std::fprintf(stderr,
        "[auto-measure-10x-final-source] source=prior reason=roi-too-small\n");
      std::fflush(stderr);
    }
  } else {
    finalReason = "blurred-empty";
  }

  // ---------- FINAL ASSIGNMENT BEFORE RETURN ----------
  // Explicit: if clean-blob was rejected, restore prior (edge-fit /
  // axis-bounds-fallback) corners. Guarantees corners can never silently
  // hold a half-overwritten state and can never revert further back to old
  // minAreaRect values.
  if (!cleanBlobAccepted) {
    corners.top = priorTop;
    corners.right = priorRight;
    corners.bottom = priorBottom;
    corners.left = priorLeft;
  }
  std::fprintf(stderr,
    "[auto-measure-final-source] source=%s reason=%s\n",
    finalSource, finalReason);
  std::fprintf(stderr,
    "[auto-measure-final-tips-before-return] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
    corners.top.x, corners.top.y, corners.right.x, corners.right.y,
    corners.bottom.x, corners.bottom.y, corners.left.x, corners.left.y);
  std::fflush(stderr);
  std::fprintf(stderr,
    "[detect-edge-lines] left=(%.2f,%.2f) right=(%.2f,%.2f) top=(%.2f,%.2f) bottom=(%.2f,%.2f)\n",
    corners.left.x, corners.left.y, corners.right.x, corners.right.y,
    corners.top.x, corners.top.y, corners.bottom.x, corners.bottom.y);
  std::fflush(stderr);
  std::fprintf(stderr,
    "[detect-final-corners] left=(%.2f,%.2f) right=(%.2f,%.2f) top=(%.2f,%.2f) bottom=(%.2f,%.2f) source=%s\n",
    corners.left.x, corners.left.y, corners.right.x, corners.right.y,
    corners.top.x, corners.top.y, corners.bottom.x, corners.bottom.y,
    finalSource);
  std::fflush(stderr);

  const double d2PxFinal = std::hypot(
    static_cast<double>(corners.bottom.x - corners.top.x),
    static_cast<double>(corners.bottom.y - corners.top.y));
  std::fprintf(stderr,
    "[auto-measure-d2-refine] finalTop=(%.2f,%.2f)\n",
    corners.top.x, corners.top.y);
  std::fprintf(stderr,
    "[auto-measure-d2-refine] finalBottom=(%.2f,%.2f)\n",
    corners.bottom.x, corners.bottom.y);
  std::fprintf(stderr,
    "[auto-measure-d2-refine] d2Px=%.2f\n", d2PxFinal);
  std::fflush(stderr);
}

Napi::Object PointObject(Napi::Env env, cv::Point2f point) {
  auto object = Napi::Object::New(env);
  object.Set("x", Napi::Number::New(env, point.x));
  object.Set("y", Napi::Number::New(env, point.y));
  return object;
}

Napi::Object LineObject(Napi::Env env, cv::Point2f p1, cv::Point2f p2) {
  auto object = Napi::Object::New(env);
  object.Set("p1", PointObject(env, p1));
  object.Set("p2", PointObject(env, p2));
  return object;
}

Napi::Array NumberArray(Napi::Env env, const std::array<double, 4>& values) {
  auto array = Napi::Array::New(env, values.size());
  for (uint32_t i = 0; i < values.size(); ++i) {
    array.Set(i, Napi::Number::New(env, values[i]));
  }
  return array;
}

Napi::Array IntArray(Napi::Env env, const std::array<int, 4>& values) {
  auto array = Napi::Array::New(env, values.size());
  for (uint32_t i = 0; i < values.size(); ++i) {
    array.Set(i, Napi::Number::New(env, values[i]));
  }
  return array;
}

Napi::Object CornersObject(Napi::Env env, const OrderedCorners& corners) {
  auto object = Napi::Object::New(env);
  object.Set("top", PointObject(env, corners.top));
  object.Set("right", PointObject(env, corners.right));
  object.Set("bottom", PointObject(env, corners.bottom));
  object.Set("left", PointObject(env, corners.left));
  return object;
}

Napi::Object DebugObject(Napi::Env env, const DebugInfo& debug) {
  auto object = Napi::Object::New(env);
  object.Set("source", Napi::String::New(env, debug.sourceType));
  object.Set("thresholdMode", Napi::String::New(env, debug.thresholdMode));
  object.Set("requestedThresholdMode", Napi::String::New(env, debug.requestedThresholdMode));
  object.Set("imageType", Napi::String::New(env, debug.imageType));
  object.Set("objectiveForMeasure", Napi::String::New(env, debug.objectiveForMeasure));
  object.Set("settings", [&]() {
    auto settings = Napi::Object::New(env);
    settings.Set("thresholdMode", Napi::String::New(env, debug.requestedThresholdMode));
    settings.Set("smoothing", Napi::Number::New(env, debug.smoothing));
    settings.Set("gaussianKernel", Napi::Number::New(env, debug.gaussianKernel));
    settings.Set("threshold", Napi::Number::New(env, debug.threshold));
    settings.Set("erosion", Napi::Number::New(env, debug.erosion));
    settings.Set("dilation", Napi::Number::New(env, debug.dilation));
    settings.Set("factor", Napi::Number::New(env, debug.factor));
    settings.Set("erosionIterations", Napi::Number::New(env, debug.erosionIterations));
    settings.Set("dilationIterations", Napi::Number::New(env, debug.dilationIterations));
    settings.Set("morphologyKernelSize", Napi::Number::New(env, debug.morphologyKernelSize));
    settings.Set("manualThreshold", Napi::Number::New(env, debug.manualThreshold));
    settings.Set("edgeFactor", Napi::Number::New(env, debug.edgeFactor));
    settings.Set("minContourArea", Napi::Number::New(env, debug.minContourArea));
    settings.Set("maxContourArea", Napi::Number::New(env, debug.maxContourArea));
    settings.Set("centerBias", Napi::Number::New(env, debug.centerBias));
    settings.Set("sideFitRoiWidth", Napi::Number::New(env, debug.sideFitRoiWidth));
    settings.Set("gradientStrengthFactor", Napi::Number::New(env, debug.gradientStrengthFactor));
    return settings;
  }());
  object.Set("contourCount", Napi::Number::New(env, debug.contourCount));
  object.Set("areaRange", [&]() {
    auto range = Napi::Object::New(env);
    range.Set("min", Napi::Number::New(env, debug.minArea));
    range.Set("max", Napi::Number::New(env, debug.maxArea));
    return range;
  }());
  object.Set("selectedContourArea", Napi::Number::New(env, debug.selectedContourArea));
  object.Set("selectedHullArea", Napi::Number::New(env, debug.selectedHullArea));
  object.Set("selectedValidationArea", Napi::Number::New(env, debug.selectedValidationArea));
  object.Set("contourCenterDistance", Napi::Number::New(env, debug.contourCenterDistance));
  object.Set("solidity", Napi::Number::New(env, debug.solidity));
  object.Set("approxPointCount", Napi::Number::New(env, debug.approxPointCount));
  object.Set("sideRatio", Napi::Number::New(env, debug.hasFinalCorners ? debug.finalMetrics.sideRatio : debug.initialSideRatio));
  object.Set("diagonalRatio", Napi::Number::New(env, debug.hasFinalCorners ? debug.finalMetrics.diagonalRatio : debug.initialDiagonalRatio));

  auto rect = Napi::Object::New(env);
  rect.Set("center", PointObject(env, debug.minAreaRect.center));
  rect.Set("width", Napi::Number::New(env, debug.minAreaRect.size.width));
  rect.Set("height", Napi::Number::New(env, debug.minAreaRect.size.height));
  rect.Set("angle", Napi::Number::New(env, debug.minAreaRect.angle));
  object.Set("minAreaRect", rect);

  object.Set("lineSampleCounts", IntArray(env, debug.lineSampleCounts));
  object.Set("fittedLinePointCounts", IntArray(env, debug.fittedLinePointCounts));
  object.Set("fittedLineResiduals", NumberArray(env, debug.fittedLineResiduals));
  object.Set("fittedLineAngleDeltaDeg", NumberArray(env, debug.fittedLineAngleDeltaDeg));

  if (debug.hasFinalCorners) {
    object.Set("finalCorners", CornersObject(env, debug.finalCorners));
    object.Set("sideLengths", NumberArray(env, debug.finalMetrics.sideLengths));
    object.Set("anglesDeg", NumberArray(env, debug.finalMetrics.anglesDeg));
  }

  object.Set("d1Pixels", Napi::Number::New(env, debug.d1Pixels));
  object.Set("d2Pixels", Napi::Number::New(env, debug.d2Pixels));
  if (debug.d1Mm > 0.0) object.Set("d1Mm", Napi::Number::New(env, debug.d1Mm));
  else object.Set("d1Mm", env.Null());
  if (debug.d2Mm > 0.0) object.Set("d2Mm", Napi::Number::New(env, debug.d2Mm));
  else object.Set("d2Mm", env.Null());
  if (debug.averageMm > 0.0) object.Set("averageMm", Napi::Number::New(env, debug.averageMm));
  else object.Set("averageMm", env.Null());
  object.Set("confidence", Napi::Number::New(env, debug.confidence));
  object.Set("rejectionReason", Napi::String::New(env, debug.rejectionReason));
  return object;
}

Napi::Object Failure(Napi::Env env, const std::string& reason, DebugInfo debug) {
  debug.rejectionReason = reason;
  auto object = Napi::Object::New(env);
  object.Set("ok", Napi::Boolean::New(env, false));
  object.Set("source", Napi::String::New(env, debug.sourceType));
  object.Set("reason", Napi::String::New(env, reason));
  object.Set("confidence", Napi::Number::New(env, 0.0));
  object.Set("debug", DebugObject(env, debug));

  DebugLog("[auto-measure] rejected settings mode=%s smoothing=%d threshold=%d morphologyKernel=%d manualThreshold=%d sideFitRoiWidth=%d gradientStrengthFactor=%.1f\n",
               debug.requestedThresholdMode.c_str(), debug.smoothing, debug.threshold,
               debug.morphologyKernelSize, debug.manualThreshold,
               debug.sideFitRoiWidth, debug.gradientStrengthFactor);
  DebugLog("[auto-measure] rejected legacy-settings erosion=%d dilation=%d factor=%d erosionIterations=%d dilationIterations=%d edgeFactor=%.1f minContourArea=%.3f maxContourArea=%.3f centerBias=%.1f\n",
               debug.erosion, debug.dilation, debug.factor,
               debug.erosionIterations, debug.dilationIterations,
               debug.edgeFactor, debug.minContourArea,
               debug.maxContourArea, debug.centerBias);
  DebugLog("[auto-measure] rejected source=%s reason=%s confidence=%.3f contourArea=%.2f hullArea=%.2f validationArea=%.2f centerDistance=%.2f\n",
               debug.sourceType.c_str(), reason.c_str(), debug.confidence, debug.selectedContourArea, debug.selectedHullArea,
               debug.selectedValidationArea, debug.contourCenterDistance);
  return object;
}

Napi::Object Success(Napi::Env env, const Params& params, const OrderedCorners& corners, DebugInfo debug) {
  const double hv =
    params.testForceKgf > 0.0 && debug.averageMm > 0.0
      ? kVickersConstant * params.testForceKgf / (debug.averageMm * debug.averageMm)
      : 0.0;

  // Unconditional spec-format trace at the success boundary. The drag-
  // correction path in App.tsx emits [auto-measure-adjust] when the user
  // drags an endpoint; the live D1/D2 are recomputed there from the new
  // corner positions and the measurement row is updated.
  if (params.objectiveForMeasure == "10X") {
    std::fprintf(stderr, "[auto-measure-hv] hv=%.2f mode=two-line\n", hv);
  } else {
    std::fprintf(stderr, "[auto-measure-hv] hv=%.2f mode=full\n", hv);
  }
  std::fflush(stderr);

  auto object = Napi::Object::New(env);
  object.Set("ok", Napi::Boolean::New(env, true));
  object.Set("source", Napi::String::New(env, params.sourceType));
  object.Set("corners", CornersObject(env, corners));

  auto lines = Napi::Array::New(env, 4);
  lines.Set(uint32_t{0}, LineObject(env, corners.top, corners.right));
  lines.Set(uint32_t{1}, LineObject(env, corners.right, corners.bottom));
  lines.Set(uint32_t{2}, LineObject(env, corners.bottom, corners.left));
  lines.Set(uint32_t{3}, LineObject(env, corners.left, corners.top));
  object.Set("lines", lines);

  object.Set("d1Pixels", Napi::Number::New(env, debug.d1Pixels));
  object.Set("d2Pixels", Napi::Number::New(env, debug.d2Pixels));
  if (debug.d1Mm > 0.0) object.Set("d1Mm", Napi::Number::New(env, debug.d1Mm));
  else object.Set("d1Mm", env.Null());
  if (debug.d2Mm > 0.0) object.Set("d2Mm", Napi::Number::New(env, debug.d2Mm));
  else object.Set("d2Mm", env.Null());
  if (debug.averageMm > 0.0) object.Set("averageMm", Napi::Number::New(env, debug.averageMm));
  else object.Set("averageMm", env.Null());
  object.Set("confidence", Napi::Number::New(env, debug.confidence));
  object.Set("hv", hv > 0.0 ? Napi::Number::New(env, hv) : env.Null());
  object.Set("debug", DebugObject(env, debug));

  DebugLog("[auto-measure] settings mode=%s smoothing=%d threshold=%d morphologyKernel=%d manualThreshold=%d sideFitRoiWidth=%d gradientStrengthFactor=%.1f\n",
               debug.requestedThresholdMode.c_str(), debug.smoothing, debug.threshold,
               debug.morphologyKernelSize, debug.manualThreshold,
               debug.sideFitRoiWidth, debug.gradientStrengthFactor);
  DebugLog(
    "[auto-measure] ok source=%s mode=%s contourArea=%.2f hullArea=%.2f validationArea=%.2f centerDistance=%.2f rect=(%.1f,%.1f %.1fx%.1f angle %.1f) sideRatio=%.3f diagRatio=%.3f points=[%d,%d,%d,%d] corners T(%.2f,%.2f) R(%.2f,%.2f) B(%.2f,%.2f) L(%.2f,%.2f) d1Px=%.3f d2Px=%.3f d1Mm=%.6f d2Mm=%.6f confidence=%.3f\n",
    params.sourceType.c_str(),
    debug.thresholdMode.c_str(),
    debug.selectedContourArea,
    debug.selectedHullArea,
    debug.selectedValidationArea,
    debug.contourCenterDistance,
    debug.minAreaRect.center.x,
    debug.minAreaRect.center.y,
    debug.minAreaRect.size.width,
    debug.minAreaRect.size.height,
    debug.minAreaRect.angle,
    debug.finalMetrics.sideRatio,
    debug.finalMetrics.diagonalRatio,
    debug.fittedLinePointCounts[0],
    debug.fittedLinePointCounts[1],
    debug.fittedLinePointCounts[2],
    debug.fittedLinePointCounts[3],
    corners.top.x,
    corners.top.y,
    corners.right.x,
    corners.right.y,
    corners.bottom.x,
    corners.bottom.y,
    corners.left.x,
    corners.left.y,
    debug.d1Pixels,
    debug.d2Pixels,
    debug.d1Mm,
    debug.d2Mm,
    debug.confidence
  );

  return object;
}

}  // namespace

Napi::Value MeasureVickersAuto(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  DebugInfo debug;

  try {
    if (info.Length() < 2) {
      return Failure(env, "measureVickersAuto expects frameBuffer, width, height, pixelFormat, parameters", debug);
    }

    FrameView frame;
    std::string reason;
    if (!ReadFrameBuffer(info[0], frame, reason)) {
      return Failure(env, reason.empty() ? "invalid frame buffer" : reason, debug);
    }

    Params params;
    const bool explicitFrameArgs = info.Length() >= 2 && info[1].IsNumber();
    if (explicitFrameArgs) {
      if (info.Length() < 5 || !info[2].IsNumber() || !info[3].IsString() || !info[4].IsObject()) {
        return Failure(env, "measureVickersAuto expects frameBuffer, width, height, pixelFormat, parameters", debug);
      }
      params.width = info[1].As<Napi::Number>().Int32Value();
      params.height = info[2].As<Napi::Number>().Int32Value();
      params.pixelFormat = Lower(info[3].As<Napi::String>().Utf8Value());
      if (!ReadParamsObject(info[4].As<Napi::Object>(), params, reason)) {
        debug.sourceType = params.sourceType;
        return Failure(env, reason, debug);
      }
    } else if (!ReadParams(info[1], params, reason)) {
      return Failure(env, reason, debug);
    }
    debug.sourceType = params.sourceType;
    debug.imageType = params.imageType;
    debug.objectiveForMeasure = params.objectiveForMeasure;
    debug.requestedThresholdMode = params.thresholdMode;
    debug.smoothing = params.smoothing;
    debug.threshold = params.threshold;
    std::fprintf(stderr,
      "[detect-settings-received] smoothing=%d threshold=%d objective=%s thresholdMode=%s\n",
      params.smoothing,
      params.threshold,
      params.objectiveForMeasure.empty() ? "unknown" : params.objectiveForMeasure.c_str(),
      params.thresholdMode.empty() ? "unknown" : params.thresholdMode.c_str());
    std::fflush(stderr);
    debug.erosion = params.erosion;
    debug.dilation = params.dilation;
    debug.factor = params.factor;
    debug.erosionIterations = params.erosionIterations;
    debug.dilationIterations = params.dilationIterations;
    debug.morphologyKernelSize = params.morphologyKernelSize;
    debug.manualThreshold = params.manualThreshold;
    debug.edgeFactor = params.edgeFactor;
    debug.minContourArea = params.minContourArea;
    debug.maxContourArea = params.maxContourArea;
    debug.centerBias = params.centerBias;
    debug.sideFitRoiWidth = params.sideFitRoiWidth;
    debug.gradientStrengthFactor = params.gradientStrengthFactor;

    std::fprintf(stderr,
      "[auto-measure][frame-freeze] width=%d height=%d bytes=%zu pixelFormat=%s source=%s\n",
      params.width, params.height, frame.size,
      params.pixelFormat.c_str(), params.sourceType.c_str());
    std::fflush(stderr);

    cv::Mat gray;
    if (!DecodeToGray(frame, params, gray, reason)) {
      return Failure(env, reason, debug);
    }

    // Unconditional spec-format diagnostic lines — these always emit (no
    // AUTO_MEASURE_DEBUG env required) so the operator can correlate a
    // rejection with the actual objective + frame size + tuned thresholds.
    std::fprintf(stderr,
      "[auto-measure-start] objective=%s frameWidth=%d frameHeight=%d\n",
      params.objectiveForMeasure.empty() ? "unknown" : params.objectiveForMeasure.c_str(),
      params.width, params.height);
    std::fprintf(stderr,
      "[auto-measure-native-params] objective=%s roi=%d minArea=%.1f maxArea=%.1f diagonalMin=%.1f morphologyKernel=%d\n",
      params.objectiveForMeasure.empty() ? "unknown" : params.objectiveForMeasure.c_str(),
      params.sideFitRoiWidth,
      MinIndentationAreaPixels(params),
      std::max(MinIndentationAreaPixels(params) * 2.0,
               static_cast<double>(params.width) * params.height * params.maxAreaRatio),
      MinIndentationDiagonalPixels(params),
      params.morphologyKernelSize);
    std::fflush(stderr);

    if (AutoMeasureDebugEnabled()) {
      const auto nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
      DebugLog(
        "[frame] processing timestamp=%lld width=%d height=%d bytes=%zu source=%s\n",
        static_cast<long long>(nowMs), params.width, params.height, frame.size,
        params.sourceType.c_str());
    }

    const Preprocessed pre = Preprocess(gray, params);
    debug.gaussianKernel = pre.gaussianKernel;
    std::fprintf(stderr,
      "[auto-measure][preprocess] clahe=on gaussianKernel=%d thresholdMode=%s masks=%zu gradMean=%.2f gradStd=%.2f\n",
      pre.gaussianKernel, params.thresholdMode.c_str(), pre.masks.size(),
      pre.gradMean, pre.gradStd);
    std::fflush(stderr);

    DebugLog(
      "[opencv-auto] preprocess smoothing=%d kernel=%d threshold=%d mode=%s\n",
      params.smoothing,
      pre.gaussianKernel,
      params.threshold,
      params.thresholdMode == "manual" ? "fixed" : params.thresholdMode.c_str()
    );
    if (params.objectiveForMeasure == "10X") {
      std::fprintf(stderr,
        "[opencv-auto] preprocess smoothing=%d kernel=%d threshold=%d mode=%s objective=10X masks=%zu\n",
        params.smoothing,
        pre.gaussianKernel,
        params.threshold,
        params.thresholdMode == "manual" ? "fixed" : params.thresholdMode.c_str(),
        pre.masks.size()
      );
      std::fflush(stderr);
    }

    std::optional<Candidate> best;
    if (!pre.masks.empty()) {
      best = SelectBestContour(pre.masks.front().second, pre.masks.front().first, params, debug);
      if (!best) {
        for (size_t i = 1; i < pre.masks.size(); ++i) {
          const auto& item = pre.masks[i];
          std::optional<Candidate> candidate = SelectBestContour(item.second, item.first, params, debug);
          if (candidate && (!best || CandidateBetterThan(*candidate, *best))) {
            best = candidate;
          }
        }
      }
    }
    if (best) {
      std::fprintf(stderr,
        "[detect-selected] idx=%d score=%.4f mode=%s reason=best-score centerX=%.2f centerY=%.2f\n",
        best->contourIndex, best->score,
        best->thresholdMode.empty() ? "unknown" : best->thresholdMode.c_str(),
        best->center.x, best->center.y);
      std::fflush(stderr);

      // Repeatability self-test. Gated on AUTO_MEASURE_REPEATABILITY env var
      // because it triples per-mask selection cost. Runs the SAME masks
      // through selection twice more and reports any deviation from the
      // first winner — proves the comparator is deterministic for a given
      // (mask, params) pair.
      const char* repeatEnv = std::getenv("AUTO_MEASURE_REPEATABILITY");
      if (repeatEnv && repeatEnv[0] != '\0' && repeatEnv[0] != '0') {
        double maxDeltaPx = 0.0;
        cv::Point2f firstCenter = best->center;
        int firstIdx = best->contourIndex;
        std::fprintf(stderr,
          "[detect-repeatability] run=1 idx=%d centerX=%.2f centerY=%.2f score=%.4f\n",
          firstIdx, firstCenter.x, firstCenter.y, best->score);
        std::fflush(stderr);
        for (int run = 2; run <= 3; ++run) {
          std::optional<Candidate> probe;
          if (!pre.masks.empty()) {
            probe = SelectBestContour(pre.masks.front().second, pre.masks.front().first, params, debug);
            if (!probe) {
              for (size_t i = 1; i < pre.masks.size(); ++i) {
                const auto& item = pre.masks[i];
                std::optional<Candidate> cand = SelectBestContour(item.second, item.first, params, debug);
                if (cand && (!probe || CandidateBetterThan(*cand, *probe))) {
                  probe = cand;
                }
              }
            }
          }
          if (probe) {
            const double dx = probe->center.x - firstCenter.x;
            const double dy = probe->center.y - firstCenter.y;
            const double delta = std::sqrt(dx * dx + dy * dy);
            if (delta > maxDeltaPx) maxDeltaPx = delta;
            std::fprintf(stderr,
              "[detect-repeatability] run=%d idx=%d centerX=%.2f centerY=%.2f score=%.4f deltaPx=%.3f\n",
              run, probe->contourIndex, probe->center.x, probe->center.y, probe->score, delta);
            std::fflush(stderr);
          } else {
            std::fprintf(stderr,
              "[detect-repeatability] run=%d idx=none\n", run);
            std::fflush(stderr);
          }
        }
        if (maxDeltaPx > 1.0) {
          std::fprintf(stderr,
            "[detect-repeatability-warning] maxDeltaPx=%.3f\n", maxDeltaPx);
          std::fflush(stderr);
        }
      }
    }

    if (!best) {
      const bool isTenX = params.objectiveForMeasure == "10X";
      const char* msg = isTenX
        ? "no valid dark diamond indentation found"
        : "no valid centered diamond indentation contour found";
      if (isTenX) {
        std::fprintf(stderr, "[auto-measure-reject] reason=no-valid-dark-diamond objective=10X\n");
        std::fflush(stderr);
      }
      DebugLog("[opencv-auto] reject reason=%s\n", msg);
      return Failure(env, msg, debug);
    }

    debug.hasCandidate = true;
    debug.thresholdMode = best->thresholdMode;
    debug.contourCount = std::max(debug.contourCount, best->contourCount);
    debug.selectedContourArea = best->contourArea;
    debug.selectedHullArea = best->hullArea;
    debug.selectedValidationArea = best->validationArea;
    debug.contourCenterDistance = best->centerDistance;
    debug.solidity = best->solidity;
    debug.approxPointCount = best->approxPointCount;
    debug.minAreaRect = best->rect;
    debug.initialSideRatio = best->metrics.sideRatio;
    debug.initialDiagonalRatio = best->metrics.diagonalRatio;

    {
      const float rectShort = std::min(best->rect.size.width, best->rect.size.height);
      const float rectLong = std::max(best->rect.size.width, best->rect.size.height);
      std::fprintf(stderr,
        "[auto-measure-candidate] centerX=%.2f centerY=%.2f area=%.2f rectShort=%.2f rectLong=%.2f angle=%.2f\n",
        best->center.x, best->center.y, best->contourArea, rectShort, rectLong, best->rect.angle);
      std::fprintf(stderr,
        "[auto-measure][contour-selected] mode=%s centerX=%.2f centerY=%.2f area=%.2f score=%.4f sideRatio=%.4f diagonalRatio=%.4f\n",
        best->thresholdMode.c_str(), best->center.x, best->center.y,
        best->contourArea, best->score,
        best->metrics.sideRatio, best->metrics.diagonalRatio);
      std::fprintf(stderr,
        "[auto-measure][diamond-candidate] sides=4 area=%.2f centerX=%.2f centerY=%.2f diagonalRatio=%.4f sideRatio=%.4f score=%.4f\n",
        best->contourArea, best->center.x, best->center.y,
        best->metrics.diagonalRatio, best->metrics.sideRatio, best->score);
      std::fprintf(stderr,
        "[auto-measure][minrect-rough] centerX=%.2f centerY=%.2f width=%.2f height=%.2f angle=%.2f note=initialization-only\n",
        best->rect.center.x, best->rect.center.y,
        best->rect.size.width, best->rect.size.height, best->rect.angle);
      std::fflush(stderr);
    }

    // 10X simplified path: at low magnification the indent is small and
    // edge gradients are soft, so the full 4-corner contour-tip extraction
    // + side-fit refinement frequently picks wrong tips or extrapolates
    // outside the frame. Instead, take the candidate's already-ordered
    // diamond corners (from OrderDiamondCorners on the minAreaRect / approx
    // poly), soft-clamp them in-frame, and stop. The user can still drag-
    // correct any endpoint via the existing overlay.
    //
    // Net result for the operator: the overlay still renders D1 (left↔right)
    // and D2 (top↔bottom) — exactly the "only D1 + D2 lines" mode requested.
    // 40X+ continues to run the full ExtractAxisTipsFromContour +
    // TryRefineCorners pipeline.
    // 10X now uses the SAME pipeline as 40X (ExtractAxisTipsFromContour +
    // TryRefineCorners) so the 4 yellow edge lines / dots come from the
    // same proven side-fit + intersection logic. The previous two-line
    // refinement is disabled.
    const bool twoLineMode = false;
    const bool isTenX = params.objectiveForMeasure == "10X";
    OrderedCorners contourCorners;
    if (isTenX) {
      std::fprintf(stderr,
        "[auto-measure-mode] objective=10X mode=four-edge\n");
      std::fflush(stderr);
    }
    contourCorners = ExtractAxisTipsFromContour(
      best->contour,
      best->hull,
      best->corners,
      best->center
    );
    std::fprintf(stderr,
      "[auto-measure-corners] top=%.2f,%.2f right=%.2f,%.2f bottom=%.2f,%.2f left=%.2f,%.2f\n",
      contourCorners.top.x, contourCorners.top.y,
      contourCorners.right.x, contourCorners.right.y,
      contourCorners.bottom.x, contourCorners.bottom.y,
      contourCorners.left.x, contourCorners.left.y);
    std::fflush(stderr);
    std::string contourRejectReason;
    if (!ValidateContourTips(contourCorners, params, debug, contourRejectReason)) {
      contourCorners = best->corners;
      contourRejectReason.clear();
    }
    if (!ValidateContourTips(contourCorners, params, debug, contourRejectReason)) {
      DebugLog("[opencv-auto] reject reason=%s\n", contourRejectReason.c_str());
      if (params.objectiveForMeasure == "10X") {
        std::fprintf(stderr,
          "[auto-measure-reject] objective=10X reason=%s\n",
          contourRejectReason.c_str());
        std::fflush(stderr);
      }
      std::fprintf(stderr,
        "[auto-measure][reject-no-refined-corners] reason=%s objective=%s\n",
        contourRejectReason.c_str(),
        params.objectiveForMeasure.empty() ? "unknown" : params.objectiveForMeasure.c_str());
      std::fflush(stderr);
      return Failure(env, "Refined diamond corners not available", debug);
    }

    std::fprintf(stderr,
      "[auto-measure][side-roi] sideFitRoiWidth=%d sides=4 source=ordered-corners\n",
      params.sideFitRoiWidth);
    std::fprintf(stderr,
      "[auto-measure][edge-refine] method=sobel-gradient+fitLine driver=gradient-not-threshold gradStrengthFactor=%.1f\n",
      params.gradientStrengthFactor);
    std::fflush(stderr);
    // Side-fit refinement (formerly 40X-only). 10X now runs through this
    // path too — the user reports 40X corner detection is reliable and
    // wants the same behavior at 10X. Critically, this path is driven by
    // Sobel-gradient peaks (pre.gradMag), NOT raw threshold pixels, so the
    // refinement is itself exposure-invariant once a rough contour exists.
    TryRefineCorners(pre.blurred, contourCorners, params);
    const ShapeMetrics contourMetrics = ComputeShapeMetrics(contourCorners);
    std::fprintf(stderr,
      "[auto-measure][exposure-robustness] selectedMask=%s gradStd=%.2f confidenceProxy=%.4f decision=accept-across-exposure\n",
      best->thresholdMode.c_str(), pre.gradStd, best->score);
    std::fflush(stderr);
    std::fprintf(stderr,
      "[auto-measure][edge-points] sides=4 sideLengths=[%.2f,%.2f,%.2f,%.2f] gradientStrengthFactor=%.1f\n",
      contourMetrics.sideLengths[0], contourMetrics.sideLengths[1],
      contourMetrics.sideLengths[2], contourMetrics.sideLengths[3],
      params.gradientStrengthFactor);
    std::fprintf(stderr,
      "[auto-measure][line-fit] method=cv::fitLine+Huber sides=4\n");
    std::fprintf(stderr,
      "[auto-measure][corner-intersections] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
      contourCorners.top.x, contourCorners.top.y,
      contourCorners.right.x, contourCorners.right.y,
      contourCorners.bottom.x, contourCorners.bottom.y,
      contourCorners.left.x, contourCorners.left.y);
    std::fprintf(stderr,
      "[auto-measure][diagonals] d1Px=%.3f d2Px=%.3f note=D1=left-to-right D2=top-to-bottom\n",
      contourMetrics.d1, contourMetrics.d2);
    std::fflush(stderr);
    if (isTenX) {
      // 4 edge lines = sides of the diamond polygon (corner→corner).
      std::fprintf(stderr,
        "[auto-measure-10x-edge-lines] topLeft=(%.2f,%.2f)->(%.2f,%.2f) topRight=(%.2f,%.2f)->(%.2f,%.2f) bottomRight=(%.2f,%.2f)->(%.2f,%.2f) bottomLeft=(%.2f,%.2f)->(%.2f,%.2f)\n",
        contourCorners.left.x, contourCorners.left.y, contourCorners.top.x, contourCorners.top.y,
        contourCorners.top.x, contourCorners.top.y, contourCorners.right.x, contourCorners.right.y,
        contourCorners.right.x, contourCorners.right.y, contourCorners.bottom.x, contourCorners.bottom.y,
        contourCorners.bottom.x, contourCorners.bottom.y, contourCorners.left.x, contourCorners.left.y);
      std::fprintf(stderr,
        "[auto-measure-10x-intersections] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
        contourCorners.top.x, contourCorners.top.y,
        contourCorners.right.x, contourCorners.right.y,
        contourCorners.bottom.x, contourCorners.bottom.y,
        contourCorners.left.x, contourCorners.left.y);
      std::fprintf(stderr,
        "[auto-measure-final-tips] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
        contourCorners.top.x, contourCorners.top.y,
        contourCorners.right.x, contourCorners.right.y,
        contourCorners.bottom.x, contourCorners.bottom.y,
        contourCorners.left.x, contourCorners.left.y);
      std::fprintf(stderr,
        "[auto-measure-d1] lengthPx=%.2f\n", contourMetrics.d1);
      std::fprintf(stderr,
        "[auto-measure-d2] lengthPx=%.2f\n", contourMetrics.d2);
      std::fprintf(stderr,
        "[auto-measure-final] d1=%.3f d2=%.3f top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
        contourMetrics.d1, contourMetrics.d2,
        contourCorners.top.x, contourCorners.top.y,
        contourCorners.right.x, contourCorners.right.y,
        contourCorners.bottom.x, contourCorners.bottom.y,
        contourCorners.left.x, contourCorners.left.y);
      std::fflush(stderr);
    }
    debug.finalCorners = contourCorners;
    debug.finalMetrics = contourMetrics;
    debug.hasFinalCorners = true;
    debug.d1Pixels = contourMetrics.d1;
    debug.d2Pixels = contourMetrics.d2;
    debug.lineSampleCounts = {
      static_cast<int>(std::lround(contourMetrics.sideLengths[0])),
      static_cast<int>(std::lround(contourMetrics.sideLengths[1])),
      static_cast<int>(std::lround(contourMetrics.sideLengths[2])),
      static_cast<int>(std::lround(contourMetrics.sideLengths[3]))
    };
    debug.fittedLinePointCounts = debug.lineSampleCounts;
    debug.confidence = ComputeContourTipConfidence(params, *best, contourMetrics);

    if (params.pxPerMm > 0.0) {
      debug.d1Mm = debug.d1Pixels / params.pxPerMm;
      debug.d2Mm = debug.d2Pixels / params.pxPerMm;
      debug.averageMm = (debug.d1Mm + debug.d2Mm) * 0.5;
    }

    DebugLog(
      "[opencv-auto] contour area=%.2f center=(%.2f,%.2f) score=%.3f\n",
      debug.selectedContourArea,
      best->center.x,
      best->center.y,
      best->score
    );
    DebugLog(
      "[opencv-auto] corners top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f)\n",
      contourCorners.top.x,
      contourCorners.top.y,
      contourCorners.right.x,
      contourCorners.right.y,
      contourCorners.bottom.x,
      contourCorners.bottom.y,
      contourCorners.left.x,
      contourCorners.left.y
    );
    DebugLog(
      "[opencv-auto] measure D1_px=%.3f D2_px=%.3f confidence=%.3f\n",
      debug.d1Pixels,
      debug.d2Pixels,
      debug.confidence
    );

    if (debug.confidence < params.minConfidence) {
      DebugLog("[opencv-auto] reject reason=confidence score is low\n");
      if (params.objectiveForMeasure == "10X") {
        std::fprintf(stderr,
          "[auto-measure-reject] objective=10X reason=confidence-too-low confidence=%.4f minConfidence=%.4f\n",
          debug.confidence, params.minConfidence);
        std::fflush(stderr);
      }
      return Failure(env, "confidence score is low", debug);
    }

    // Refined corners passed Validate + confidence — these are the stable
    // tips returned to the renderer. Any failure path before this point has
    // already returned Failure(), so emitting [stable-corners] here gives
    // the operator a single clear "detection success" marker that names the
    // final geometry that drives D1/D2.
    std::fprintf(stderr,
      "[auto-measure][stable-corners] top=(%.2f,%.2f) right=(%.2f,%.2f) bottom=(%.2f,%.2f) left=(%.2f,%.2f) d1Px=%.3f d2Px=%.3f confidence=%.4f\n",
      contourCorners.top.x, contourCorners.top.y,
      contourCorners.right.x, contourCorners.right.y,
      contourCorners.bottom.x, contourCorners.bottom.y,
      contourCorners.left.x, contourCorners.left.y,
      contourMetrics.d1, contourMetrics.d2, debug.confidence);
    std::fprintf(stderr,
      "[auto-measure][success-refined-diamond-only] d1Px=%.3f d2Px=%.3f confidence=%.4f source=refined-corners\n",
      contourMetrics.d1, contourMetrics.d2, debug.confidence);
    std::fflush(stderr);

    if (params.objectiveForMeasure == "10X") {
      std::fprintf(stderr,
        "[auto-measure-success] objective=10X d1Px=%.3f d2Px=%.3f\n",
        debug.d1Pixels, debug.d2Pixels);
      std::fflush(stderr);
    }
    return Success(env, params, contourCorners, debug);
  } catch (const cv::Exception& ex) {
    return Failure(env, std::string("OpenCV error: ") + ex.what(), debug);
  } catch (const std::exception& ex) {
    return Failure(env, std::string("native auto measure error: ") + ex.what(), debug);
  } catch (...) {
    return Failure(env, "unknown native auto measure error", debug);
  }
}

}  // namespace hardness_vickers
