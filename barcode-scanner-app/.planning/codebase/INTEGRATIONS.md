# Integrations - BillItUp

## Native Integrations (Capacitor)
- **Barcode Scanning**: `@capacitor-mlkit/barcode-scanning` - High-performance barcode detection using MLKit.
- **Camera**: `@capacitor/camera` - Used for capturing bill images for OCR.
- **Filesystem**: `@capacitor/filesystem` - For saving generated PDFs.
- **Sharing**: `@capacitor/share` - For sharing bills via native share sheets.
- **Haptics**: `@capacitor/haptics` - For tactile feedback during interactions.
- **App Management**: `@capacitor/app` - For handling system-level app events (like restoration).
- **File Opener**: `@capawesome-team/capacitor-file-opener` - To preview generated PDFs.

## Libraries & Services
- **OCR (Optical Character Recognition)**: `tesseract.js` - Client-side OCR for extracting text from bill images.
- **PDF Generation**: `jspdf` and `jspdf-autotable` - For generating structured, professional bills.
- **Image Cropping**: `react-easy-crop` and `react-image-crop` - For manual image adjustment before OCR.
- **Zoom/View**: `react-quick-pinch-zoom` - For high-fidelity image inspection.
