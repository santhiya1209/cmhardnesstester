/* dvp.h — Subset of the Do3Think DVP2 SDK public header.
 *
 * Source: extracted from the vendor's `DVPCamera.chm` (Doxygen output of the
 * original `dvpcamera.h`). Bundled in-tree because the developer SDK package
 * with the original `dvp.h` / `DVPCamera64.lib` is not installed on this
 * machine — we resolve every entry point at runtime via LoadLibrary +
 * GetProcAddress against `DVPCamera64.dll` from
 * `C:\Program Files (x86)\Do3think\DVP2 x64\`.
 *
 * Only declarations actually used by the addon are kept; the rest of the
 * vendor header (tens of getters/setters for advanced features) is omitted
 * to keep this file maintainable. Add more as needed.
 */
#ifndef HARDNESS_DVP_H_
#define HARDNESS_DVP_H_

#include <windows.h>
#include <cstdint>

/* ---------------- Primitive aliases (vendor names) ---------------- */
typedef uint8_t  dvpByte;
typedef int32_t  dvpInt32;
typedef uint32_t dvpUint32;
typedef int64_t  dvpInt64;
typedef uint64_t dvpUint64;
typedef uint32_t dvpHandle;
typedef const char* dvpStr;
typedef dvpUint32 dvpReserved[32];
typedef char dvpString64[64];
typedef char dvpString128[128];

/* ---------------- Enums ---------------- */
typedef enum dvpStatus {
  DVP_STATUS_OK                       =  1,
  DVP_STATUS_FAILED                   =  0,
  DVP_STATUS_UNKNOW                   = -1,
  DVP_STATUS_NOT_SUPPORTED            = -2,
  DVP_STATUS_NOT_INITIALIZED          = -3,
  DVP_STATUS_PARAMETER_INVALID        = -4,
  DVP_STATUS_PARAMETER_OUT_OF_BOUND   = -5,
  DVP_STATUS_UNCONNECTED              = -7,
  DVP_STATUS_NOT_VALID                = -8,
  DVP_STATUS_NOT_STARTED              = -10,
  DVP_STATUS_INVALID_HANDLE           = -13,
  DVP_STATUS_DENIED                   = -31,
  DVP_STATUS_TIME_OUT                 = -1000,
  DVP_STATUS_NO_DEVICE_FOUND          = -1100,
  DVP_STATUS_DEVICE_IS_OPENED         = -1102,
  DVP_STATUS_DEVICE_IS_CLOSED         = -1103,
  DVP_STATUS_DEVICE_IS_DISCONNECTED   = -1104,
  DVP_STATUS_DEVICE_IS_OPENED_BY_ANOTHER = -1105,
  DVP_STATUS_DEVICE_IS_STARTED        = -1106,
  DVP_STATUS_DEVICE_IS_STOPPED        = -1107,
} dvpStatus;

typedef enum dvpImageFormat {
  FORMAT_MONO       = 0,
  FORMAT_BAYER_BG   = 1,
  FORMAT_BAYER_GB   = 2,
  FORMAT_BAYER_GR   = 3,
  FORMAT_BAYER_RG   = 4,
  FORMAT_BGR24      = 10,
  FORMAT_BGR32      = 11,
  FORMAT_BGR48      = 12,
  FORMAT_RGB24      = 14,
  FORMAT_RGB32      = 15,
  FORMAT_RGB48      = 16,
  FORMAT_YUV_411    = 20,
  FORMAT_YUV_422    = 21,
} dvpImageFormat;

typedef enum dvpBits {
  BITS_8  = 0,
  BITS_10 = 1,
  BITS_12 = 2,
  BITS_14 = 3,
  BITS_16 = 4,
} dvpBits;

typedef enum dvpFirstPosition {
  POSITION_TOPLEFT = 0,
  POSITION_TOPRIGHT = 1,
  POSITION_BOTTOMLEFT = 2,
  POSITION_BOTTOMRIGHT = 3,
} dvpFirstPosition;

typedef enum dvpOpenMode {
  OPEN_OFFLINE  = 0,
  OPEN_NORMAL   = 1 << 0,
  OPEN_DEBUG    = 1 << 3,
  HIGH_PRIORITY = 1 << 4,
} dvpOpenMode;

typedef enum dvpBufferMode {
  BUFFER_MODE_NEWEST = 0,
  BUFFER_MODE_FIFO   = 1,
} dvpBufferMode;

typedef enum dvpAeOperation {
  AE_OP_OFF        = 0,
  AE_OP_ONCE       = 1,
  AE_OP_CONTINUOUS = 2,
} dvpAeOperation;

/* ---------------- Structs (exact layout from vendor header) ---------------- */
typedef struct dvpRegion {
  dvpInt32 X;
  dvpInt32 Y;
  dvpInt32 W;
  dvpInt32 H;
  dvpReserved reserved;
} dvpRegion;

typedef struct dvpFrame {
  enum dvpImageFormat format;
  enum dvpBits        bits;
  dvpUint32           uBytes;
  dvpInt32            iWidth;
  dvpInt32            iHeight;
  dvpUint64           uFrameID;
  dvpUint64           uTimestamp;
  double              fExposure;
  float               fAGain;
  enum dvpFirstPosition position;
  bool                bFlipHorizontalState;
  bool                bFlipVerticalState;
  bool                bRotateState;
  bool                bRotateOpposite;
  dvpUint32           internalFlags;
  dvpUint32           internalValue;
  dvpUint64           uTriggerId;
  dvpUint64           userValue;
  dvpUint32           reserved[24];
} dvpFrame;

typedef struct dvpDoubleDescr {
  double      fStep;
  double      fMin;
  double      fMax;
  double      fDefault;
  dvpReserved reserved;
} dvpDoubleDescr;

typedef struct dvpFloatDescr {
  float       fStep;
  float       fMin;
  float       fMax;
  float       fDefault;
  dvpReserved reserved;
} dvpFloatDescr;

typedef struct dvpCameraInfo {
  dvpString64  Vendor;
  dvpString64  Manufacturer;
  dvpString64  Model;
  dvpString64  Family;
  dvpString64  LinkName;
  dvpString64  SensorInfo;
  dvpString64  HardwareVersion;
  dvpString64  FirmwareVersion;
  dvpString64  KernelVersion;
  dvpString64  DscamVersion;
  dvpString64  FriendlyName;
  dvpString64  PortInfo;
  dvpString64  SerialNumber;
  dvpString128 CameraInfo;
  dvpString128 UserID;
  dvpString64  OriginalSerialNumber;
  dvpString64  reserved;
} dvpCameraInfo;

typedef struct dvpBufferConfig {
  enum dvpBufferMode mode;
  dvpUint32          uQueueSize;
  bool               bDropNew;
  bool               bLite;
  dvpReserved        reserved;
} dvpBufferConfig;

/* ---------------- Function pointer typedefs (cdecl on Windows) ---------------- */
typedef dvpStatus (*pfn_dvpRefresh)(dvpUint32 *pCount);
typedef dvpStatus (*pfn_dvpOpen)(dvpUint32 index, dvpOpenMode mode, dvpHandle *pHandle);
typedef dvpStatus (*pfn_dvpOpenByName)(dvpStr friendlyName, dvpOpenMode mode, dvpHandle *pHandle);
typedef dvpStatus (*pfn_dvpClose)(dvpHandle handle);
typedef dvpStatus (*pfn_dvpStart)(dvpHandle handle);
typedef dvpStatus (*pfn_dvpStop)(dvpHandle handle);
typedef dvpStatus (*pfn_dvpGetFrame)(dvpHandle handle, dvpFrame *pFrame, void **pBuffer, dvpUint32 timeout);
typedef dvpStatus (*pfn_dvpGetExposure)(dvpHandle handle, double *pExposure);
typedef dvpStatus (*pfn_dvpSetExposure)(dvpHandle handle, double Exposure);
typedef dvpStatus (*pfn_dvpGetExposureDescr)(dvpHandle handle, dvpDoubleDescr *pExposureDescr);
typedef dvpStatus (*pfn_dvpGetAnalogGain)(dvpHandle handle, float *pAnalogGain);
typedef dvpStatus (*pfn_dvpSetAnalogGain)(dvpHandle handle, float AnalogGain);
typedef dvpStatus (*pfn_dvpGetAnalogGainDescr)(dvpHandle handle, dvpFloatDescr *pAnalogGainDescr);
typedef dvpStatus (*pfn_dvpGetTriggerState)(dvpHandle handle, bool *pTriggerState);
typedef dvpStatus (*pfn_dvpSetTriggerState)(dvpHandle handle, bool TriggerState);
typedef dvpStatus (*pfn_dvpSetAeOperation)(dvpHandle handle, dvpAeOperation AeOperation);
typedef dvpStatus (*pfn_dvpGetCameraInfo)(dvpHandle handle, dvpCameraInfo *pInfo);
typedef dvpStatus (*pfn_dvpGetRoi)(dvpHandle handle, dvpRegion *pRoi);
typedef dvpStatus (*pfn_dvpGetBufferQueueSize)(dvpHandle handle, dvpInt32 *pBufferQueueSize);
typedef dvpStatus (*pfn_dvpSetBufferQueueSize)(dvpHandle handle, dvpInt32 BufferQueueSize);
typedef dvpStatus (*pfn_dvpGetBufferConfig)(dvpHandle handle, dvpBufferConfig *pBufferConfig);
typedef dvpStatus (*pfn_dvpSetBufferConfig)(dvpHandle handle, dvpBufferConfig BufferConfig);

#endif /* HARDNESS_DVP_H_ */
