# Offline fonts and import checks

This installer includes 13 Google Font families (56 font files, about 27.4 MB uncompressed): Roboto, Open Sans, Montserrat, Lato, Poppins, Noto Sans, Archivo, Darker Grotesque, Hanken Grotesk, Inter, Raleway, Red Hat Mono and VT323. A Darker Grotesque SemiBold alias preserves the font name used by the supplied PPTX. Available normal/italic faces and weights are included.

These fonts are app assets, not Windows-wide font installations. The editor, local outputs and bundled stage/output-stream pages use local files. Google Font custom-font entries for these families load locally. The font picker retains the bundled choices when local-font permission is unavailable.

Editable PPTX and FreeShow show imports check the requested font names against bundled, installed and loadable custom fonts before saving the imported shows. Missing Google Fonts offer a confirmation to download the matching family. Accepting saves its files and license under the app's data folder, loads its weights/styles, and records the local fonts in custom-font settings. The download catalog contains 1,944 matched Google Fonts families; it does not embed the full catalog's font files.

Declining keeps the original font names and reports possible layout differences. Non-Google fonts require separate installation; unavailable fonts are reported. Downloads require internet the first time. Cached downloads are reused offline. Matching fonts help preserve wrapping and spacing, but do not guarantee complete PowerPoint visual parity.

Source: https://github.com/google/fonts at commit 67bc647ce1910e92f461bcc82aae30f21d21a9cc. Each bundled family includes its OFL license; `public/fonts/google/manifest.json` records file hashes. The download catalog was matched from Google's font metadata and that pinned repository snapshot.

Verification: all 56 bundled faces loaded with external requests blocked; no Google Fonts requests were made for bundled faces. The PPTX alias, font picker without local-font permission, missing-font confirmation, decline, download failure, and installed/bundled-font detection passed. A real Rubik download preserved normal/italic weights and reused its persistent cache. 62 frontend tests passed.

The installer retains existing preview limitations and re-audit findings; this font change does not resolve the separate Scripture HTML security finding or all dependency advisories.
