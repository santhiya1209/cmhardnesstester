{
  "targets": [
    {
      "target_name": "hardness_addon",
      "sources": [
        "src/addon.cpp",
        "src/camera.cpp",
        "src/dvp_dll.cpp",
        "src/vickers_auto_measure.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "include",
        "<!(node -p \"(process.env.OPENCV_INCLUDE_DIR || ((process.env.OPENCV_DIR || 'C:/Users/SANTHIYA/opencv/build') + '/include')).replace(/\\\\/g, '/')\")"
      ],
      "libraries": [
        "<!(node -p \"(process.env.OPENCV_WORLD_LIB || ((process.env.OPENCV_LIB_DIR || ((process.env.OPENCV_DIR || 'C:/Users/SANTHIYA/opencv/build') + '/x64/vc16/lib')) + '/' + (process.env.OPENCV_LIB_NAME || 'opencv_world4100.lib'))).replace(/\\\\/g, '/')\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NAPI_VERSION=8"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        ["OS=='win'", {
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": [ "/std:c++17", "/EHsc" ],
              "ExceptionHandling": 1
            }
          },
          "defines": [ "_HAS_EXCEPTIONS=1", "WIN32_LEAN_AND_MEAN", "NOMINMAX" ]
        }]
      ]
    }
  ]
}
