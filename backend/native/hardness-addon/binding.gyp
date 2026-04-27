{
  "targets": [
    {
      "target_name": "hardness_addon",
      "sources": [
        "src/addon.cpp",
        "src/camera.cpp",
        "src/dvp_dll.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "include"
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
