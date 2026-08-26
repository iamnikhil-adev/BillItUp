# Concerns & Tech Debt - BillItUp

1. **OCR Accuracy**: tesseract.js speed and accuracy on mobile can be variable depending on image quality.
2. **Build Optimization**: Ensuring the Android bundle size remains manageable with heavy dependencies like tesseract.js.
3. **Recovery Logic**: src/utils/recovery.ts needs robust handling for edge cases in app restoration.
4. **Performance**: Complex framer-motion animations should be profiled on lower-end Android devices to ensure 60fps.
5. **Types**: Some minor type casting in App.tsx (e.g., useRef<any>(null)) should be refined.
