# Learner image assets

Drop the following PNG files in this folder. The app discovers them at build
time via `import.meta.glob('./*.png')` in `src/lib/uiImages.ts`, so missing
files are treated as "no artwork" and the learner UI falls back gracefully —
nothing crashes if an image is absent.

Expected filenames (case-sensitive, matched verbatim):

- vascular_anatomy_and_medical_technology_scene.png
- futuristic_vascular_interface_design.png
- tech_style_vascular_measurement_ui_design.png
- clinical_precision_in_medical_design.png
- angiogram_with_stent_device_and_anatomy.png
- futuristic_vascular_imaging_and_angiography_scene.png
- anatomical_medical_illustration_with_vascular_deta.png
- anatomical_visualization_of_carotid_artery_stenosi.png
- vascular_scan_with_measuring_tool_detail.png
- anatomical_aneurysm_close_up_illustration.png

Topic / role mapping is defined in `src/lib/uiImages.ts`. Edit that file if
you want to repoint a slot to a different image.
