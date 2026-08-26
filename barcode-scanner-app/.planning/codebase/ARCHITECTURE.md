# Architecture - BillItUp

## High-Level Architecture
BillItUp is a client-side Capacitor application that leverages React for the UI and native plugins for hardware-intensive tasks.

### Navigation & Routing
- **React Router 7**: Managed in `App.tsx`.
- **Animated Routines**: Uses `framer-motion`'s `AnimatePresence` for smooth transition effects between Dashboard, Create Bill, and Profile pages.
- **Directional Transitions**: Logic in `AnimatedRoutes` calculates page depth to slide pages left or right appropriately.

### State Management
- **Context API**:
  - `ThemeContext`: Handles dark/light mode and Material Design 3 tokens.
  - `AlertContext`: Global snackbar/alert system.
- **Persistence Layer**:
  - `localforage`: Used for storing scanned bills and application state in IndexedDB.
  - `db.ts`: Utility layer for DB interactions.

### OCR & Image Processing Pipeline
1. **Capture**: Image captured via `Camera` or restored from app state.
2. **Pre-processing**: Crop/Zoom via `react-easy-crop`.
3. **OCR**: `tesseract.js` extracts text components (Store name, Date, Items, Total).
4. **Validation**: User reviews and modifies extracted data.
