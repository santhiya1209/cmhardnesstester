#include "vickers_auto_measure.h"

#include <opencv2/opencv.hpp>

#include <algorithm>
#include <array>
#include <cmath>
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
};

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
  params.manualThreshold = std::clamp(IntFromObject(object, "manualThreshold", params.manualThreshold), 0, 255);
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
  double gradMean = 0.0;
  double gradStd = 0.0;
  std::vector<std::pair<std::string, cv::Mat>> masks;
};

Preprocessed Preprocess(const cv::Mat& gray, const Params& params) {
  Preprocessed out;
  cv::Ptr<cv::CLAHE> clahe = cv::createCLAHE(2.2, {8, 8});
  clahe->apply(gray, out.clahe);

  const int blurKernel = params.factor >= 50 ? 7 : 5;
  cv::GaussianBlur(out.clahe, out.blurred, {blurKernel, blurKernel}, 0.0);

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
    params.manualThreshold,
    255,
    cv::THRESH_BINARY_INV
  );

  if (params.thresholdMode == "adaptive") {
    out.masks.push_back({"adaptive", ApplyMorphology(adaptive, params)});
  } else if (params.thresholdMode == "manual") {
    out.masks.push_back({"manual", ApplyMorphology(manual, params)});
  } else {
    out.masks.push_back({"otsu", ApplyMorphology(otsu, params)});
  }

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

  cv::Sobel(out.blurred, out.gradX, CV_32F, 1, 0, 3);
  cv::Sobel(out.blurred, out.gradY, CV_32F, 0, 1, 3);
  cv::magnitude(out.gradX, out.gradY, out.gradMag);
  cv::Scalar mean, stddev;
  cv::meanStdDev(out.gradMag, mean, stddev);
  out.gradMean = mean[0];
  out.gradStd = stddev[0];
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

double MinIndentationAreaPixels(const Params& params) {
  const double imageArea = static_cast<double>(params.width) * params.height;
  return std::max(120.0, imageArea * params.minAreaRatio);
}

double MinIndentationDiagonalPixels(const Params& params) {
  const double minDim = std::min(params.width, params.height);
  const double areaDiagonal = std::sqrt(std::max(1.0, MinIndentationAreaPixels(params) * 2.0));
  return std::max(minDim * 0.10, areaDiagonal);
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

  const double imageArea = static_cast<double>(params.width) * params.height;
  const double minArea = MinIndentationAreaPixels(params);
  const double maxArea = std::max(minArea * 2.0, imageArea * params.maxAreaRatio);
  debug.minArea = minArea;
  debug.maxArea = maxArea;

  const cv::Point2f imageCenter(params.width * 0.5f, params.height * 0.5f);
  const double maxCenterDistance = std::min(params.width, params.height) * params.maxCenterDistanceRatio;

  std::optional<Candidate> best;
  for (const auto& contour : contours) {
    const double area = std::abs(cv::contourArea(contour));

    std::vector<cv::Point> hull;
    cv::convexHull(contour, hull);
    const double hullArea = std::abs(cv::contourArea(hull));
    const bool edgeMaskMode = IsEdgeMaskMode(thresholdMode);
    const double validationArea = edgeMaskMode ? std::max(area, hullArea) : area;
    if (validationArea < minArea || validationArea > maxArea) continue;

    const cv::Moments m = cv::moments(contour);
    if (std::abs(m.m00) <= 1e-6) continue;
    const cv::Point2f center(static_cast<float>(m.m10 / m.m00), static_cast<float>(m.m01 / m.m00));
    const double centerDistance = Distance(center, imageCenter);
    if (centerDistance > maxCenterDistance) continue;

    const double solidity = hullArea > 1e-6 ? area / hullArea : 0.0;
    if (solidity < (edgeMaskMode ? 0.035 : 0.52)) continue;

    const cv::RotatedRect rect = cv::minAreaRect(contour);
    const double rectShort = std::min(rect.size.width, rect.size.height);
    const double rectLong = std::max(rect.size.width, rect.size.height);
    if (rectShort < 8.0 || rectLong < 12.0) continue;

    int approxPointCount = 0;
    std::vector<cv::Point2f> initial = InitialCornerEstimate(contour, rect, approxPointCount);
    if (initial.size() != 4) continue;

    const OrderedCorners corners = OrderDiamondCorners(initial, center);
    const ShapeMetrics metrics = ComputeShapeMetrics(corners);
    if (!std::isfinite(metrics.sideRatio) || metrics.sideRatio > params.maxSideLengthRatio * 1.25) continue;
    if (!std::isfinite(metrics.diagonalRatio)) continue;
    if (metrics.diagonalRatio > params.maxDiagonalRatio || (1.0 / metrics.diagonalRatio) < params.minDiagonalRatio) continue;

    double maxAngleError = 0.0;
    for (double angle : metrics.anglesDeg) {
      maxAngleError = std::max(maxAngleError, std::abs(angle - 90.0));
    }
    if (maxAngleError > params.angleToleranceDeg + 16.0) continue;

    const double areaScore = Clamp01(validationArea / (imageArea * 0.055));
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

    if (!best || candidate.score > best->score) {
      best = candidate;
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
    cv::threshold(pre.blurred, darkMask, params.manualThreshold, 255, cv::THRESH_BINARY_INV);
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

  std::fprintf(stderr, "[auto-measure] rejected settings threshold=%s erosion=%d dilation=%d factor=%d erosionIterations=%d dilationIterations=%d morphologyKernel=%d manualThreshold=%d edgeFactor=%.1f minContourArea=%.3f maxContourArea=%.3f centerBias=%.1f sideFitRoiWidth=%d gradientStrengthFactor=%.1f\n",
               debug.requestedThresholdMode.c_str(), debug.erosion, debug.dilation, debug.factor,
               debug.erosionIterations, debug.dilationIterations,
               debug.morphologyKernelSize, debug.manualThreshold, debug.edgeFactor, debug.minContourArea,
               debug.maxContourArea, debug.centerBias, debug.sideFitRoiWidth, debug.gradientStrengthFactor);
  std::fprintf(stderr, "[auto-measure] rejected source=%s reason=%s confidence=%.3f contourArea=%.2f hullArea=%.2f validationArea=%.2f centerDistance=%.2f\n",
               debug.sourceType.c_str(), reason.c_str(), debug.confidence, debug.selectedContourArea, debug.selectedHullArea,
               debug.selectedValidationArea, debug.contourCenterDistance);
  std::fflush(stderr);
  return object;
}

Napi::Object Success(Napi::Env env, const Params& params, const OrderedCorners& corners, DebugInfo debug) {
  const double hv =
    params.testForceKgf > 0.0 && debug.averageMm > 0.0
      ? kVickersConstant * params.testForceKgf / (debug.averageMm * debug.averageMm)
      : 0.0;

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

  std::fprintf(stderr, "[auto-measure] settings threshold=%s erosion=%d dilation=%d factor=%d erosionIterations=%d dilationIterations=%d morphologyKernel=%d manualThreshold=%d edgeFactor=%.1f minContourArea=%.3f maxContourArea=%.3f centerBias=%.1f sideFitRoiWidth=%d gradientStrengthFactor=%.1f\n",
               debug.requestedThresholdMode.c_str(), debug.erosion, debug.dilation, debug.factor,
               debug.erosionIterations, debug.dilationIterations,
               debug.morphologyKernelSize, debug.manualThreshold, debug.edgeFactor, debug.minContourArea,
               debug.maxContourArea, debug.centerBias, debug.sideFitRoiWidth, debug.gradientStrengthFactor);
  std::fprintf(
    stderr,
    "[auto-measure] ok source=%s threshold=%s contourArea=%.2f hullArea=%.2f validationArea=%.2f centerDistance=%.2f rect=(%.1f,%.1f %.1fx%.1f angle %.1f) sideRatio=%.3f diagRatio=%.3f points=[%d,%d,%d,%d] corners T(%.2f,%.2f) R(%.2f,%.2f) B(%.2f,%.2f) L(%.2f,%.2f) d1Px=%.3f d2Px=%.3f d1Mm=%.6f d2Mm=%.6f confidence=%.3f\n",
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
  std::fflush(stderr);

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

    cv::Mat gray;
    if (!DecodeToGray(frame, params, gray, reason)) {
      return Failure(env, reason, debug);
    }

    const Preprocessed pre = Preprocess(gray, params);

    auto returnHoughFallback = [&](DebugInfo fallbackDebug, const HoughDiamondResult& hough) -> Napi::Value {
      fallbackDebug.finalCorners = hough.corners;
      fallbackDebug.finalMetrics = ComputeShapeMetrics(hough.corners);
      fallbackDebug.hasFinalCorners = true;
      fallbackDebug.d1Pixels = fallbackDebug.finalMetrics.d1;
      fallbackDebug.d2Pixels = fallbackDebug.finalMetrics.d2;
      fallbackDebug.confidence = hough.confidence;
      if (params.pxPerMm > 0.0) {
        fallbackDebug.d1Mm = fallbackDebug.d1Pixels / params.pxPerMm;
        fallbackDebug.d2Mm = fallbackDebug.d2Pixels / params.pxPerMm;
        fallbackDebug.averageMm = (fallbackDebug.d1Mm + fallbackDebug.d2Mm) * 0.5;
      }
      return Success(env, params, hough.corners, fallbackDebug);
    };

    {
      DebugInfo darkDebug = debug;
      if (auto darkBody = TryDarkBodyFallback(pre, params, darkDebug)) {
        const ShapeMetrics darkMetrics = ComputeShapeMetrics(darkBody->corners);
        const double minDim = std::min(params.width, params.height);
        bool anglesOk = true;
        for (double angle : darkMetrics.anglesDeg) {
          if (std::abs(angle - 90.0) > params.angleToleranceDeg) {
            anglesOk = false;
            break;
          }
        }

        const bool strongSplitFacetVickers =
          darkBody->confidence >= std::max(0.42, params.minConfidence * 0.86) &&
          darkMetrics.area >= MinIndentationAreaPixels(params) * 0.72 &&
          darkMetrics.d1 >= MinIndentationDiagonalPixels(params) &&
          darkMetrics.d2 >= MinIndentationDiagonalPixels(params) &&
          darkMetrics.d1 <= minDim * 0.78 &&
          darkMetrics.d2 <= minDim * 0.78 &&
          darkMetrics.diagonalRatio <= params.maxDiagonalRatio &&
          (1.0 / darkMetrics.diagonalRatio) >= params.minDiagonalRatio &&
          darkMetrics.sideRatio <= params.maxSideLengthRatio &&
          anglesOk;

        if (strongSplitFacetVickers) {
          return returnHoughFallback(darkDebug, *darkBody);
        }
      }
    }

    std::optional<Candidate> best;
    for (const auto& item : pre.masks) {
      std::optional<Candidate> candidate = SelectBestContour(item.second, item.first, params, debug);
      if (candidate && (!best || candidate->score > best->score)) {
        best = candidate;
      }
    }

    if (!best) {
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "no valid centered diamond indentation contour found", debug);
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

    const auto initial = ToSideOrder(best->corners);
    std::array<LineModel, 4> lines;
    for (int i = 0; i < 4; ++i) {
      int sampleCount = 0;
      const cv::Point2f a = initial[i];
      const cv::Point2f b = initial[(i + 1) % 4];
      const std::vector<cv::Point2f> edgePoints = SampleEdgePoints(pre, a, b, best->center, params, sampleCount);
      const int dynamicMin = std::max(params.minLinePoints, std::min(34, std::max(8, sampleCount / 4)));
      lines[i] = FitRobustLine(edgePoints, Normalize(b - a), sampleCount, dynamicMin);
      debug.lineSampleCounts[i] = sampleCount;
      debug.fittedLinePointCounts[i] = lines[i].pointCount;
      debug.fittedLineResiduals[i] = lines[i].residual;
      debug.fittedLineAngleDeltaDeg[i] = lines[i].angleDeltaDeg;

      if (!lines[i].ok) {
        return Failure(env, "fewer than 4 valid fitted sides", debug);
      }
      if (lines[i].angleDeltaDeg > 38.0) {
        return Failure(env, "fitted edge angle deviates from diamond contour estimate", debug);
      }
    }

    OrderedCorners finalCorners;
    if (!IntersectLines(lines[3], lines[0], finalCorners.top) ||
        !IntersectLines(lines[0], lines[1], finalCorners.right) ||
        !IntersectLines(lines[1], lines[2], finalCorners.bottom) ||
        !IntersectLines(lines[2], lines[3], finalCorners.left)) {
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "adjacent fitted side intersections are unstable", debug);
    }

    if (!PointInsideImage(finalCorners.top, params) ||
        !PointInsideImage(finalCorners.right, params) ||
        !PointInsideImage(finalCorners.bottom, params) ||
        !PointInsideImage(finalCorners.left, params)) {
      debug.finalCorners = finalCorners;
      debug.hasFinalCorners = true;
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "corner intersection is outside image", debug);
    }

    TryRefineCorners(pre.blurred, finalCorners, params);

    ShapeMetrics finalMetrics = ComputeShapeMetrics(finalCorners);
    debug.finalCorners = finalCorners;
    debug.finalMetrics = finalMetrics;
    debug.hasFinalCorners = true;
    debug.d1Pixels = finalMetrics.d1;
    debug.d2Pixels = finalMetrics.d2;

    if (finalMetrics.area < debug.minArea || finalMetrics.area > debug.maxArea * 2.0) {
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "final diamond area is outside valid range", debug);
    }
    if (finalMetrics.d1 < MinIndentationDiagonalPixels(params) ||
        finalMetrics.d2 < MinIndentationDiagonalPixels(params)) {
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "selected shape is too small to be indentation", debug);
    }
    if (finalMetrics.sideRatio > params.maxSideLengthRatio) {
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "side ratio is abnormal", debug);
    }
    if (finalMetrics.diagonalRatio > params.maxDiagonalRatio ||
        (1.0 / finalMetrics.diagonalRatio) < params.minDiagonalRatio) {
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "diagonal ratio is abnormal", debug);
    }

    for (double angle : finalMetrics.anglesDeg) {
      if (std::abs(angle - 90.0) > params.angleToleranceDeg) {
        if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
          return returnHoughFallback(debug, *darkBody);
        }
        if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
          return returnHoughFallback(debug, *hough);
        }
        return Failure(env, "angles are not close to diamond geometry", debug);
      }
    }

    if (AngleBetweenDirections(lines[0].dir, lines[2].dir) > 22.0 ||
        AngleBetweenDirections(lines[1].dir, lines[3].dir) > 22.0) {
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "opposite fitted sides are not parallel enough", debug);
    }

    if (params.pxPerMm > 0.0) {
      debug.d1Mm = debug.d1Pixels / params.pxPerMm;
      debug.d2Mm = debug.d2Pixels / params.pxPerMm;
      debug.averageMm = (debug.d1Mm + debug.d2Mm) * 0.5;
    }

    debug.confidence = ComputeConfidence(params, *best, lines, finalMetrics);
    if (debug.confidence < params.minConfidence) {
      if (auto darkBody = TryDarkBodyFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *darkBody);
      }
      if (auto hough = TryHoughDiamondFallback(pre, params, debug)) {
        return returnHoughFallback(debug, *hough);
      }
      return Failure(env, "confidence score is low", debug);
    }

    return Success(env, params, finalCorners, debug);
  } catch (const cv::Exception& ex) {
    return Failure(env, std::string("OpenCV error: ") + ex.what(), debug);
  } catch (const std::exception& ex) {
    return Failure(env, std::string("native auto measure error: ") + ex.what(), debug);
  } catch (...) {
    return Failure(env, "unknown native auto measure error", debug);
  }
}

}  // namespace hardness_vickers
