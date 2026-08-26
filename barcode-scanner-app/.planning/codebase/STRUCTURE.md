# Directory Structure - BillItUp

```
barcode-scanner-app/
├── android/             # Native Android project files
├── assets/              # App icons and splash resources
├── public/              # Static assets (favicon, etc.)
├── src/
│   ├── assets/          # Project images and SVG assets
│   ├── components/      # Reusable UI components
│   │   ├── BackButtonHandler.tsx
│   │   ├── BarcodeOverlay.tsx
│   │   └── VersionLabel.tsx
│   ├── context/         # React Contexts (Theme, Alert)
│   ├── pages/           # Main view components
│   │   ├── CreateBill.tsx
│   │   ├── Dashboard.tsx
│   │   └── Profile.tsx
│   ├── utils/           # Business logic and helper functions
│   │   ├── db.ts               # persistence logic
│   │   ├── pdfGenerator.ts     # Generation logic
│   │   └── recovery.ts         # state recovery logic
│   ├── App.tsx          # Root routing and global providers
│   ├── index.css        # Global styles and Tailwind imports
│   └── main.tsx         # App entry point
├── capacitor.config.ts  # Capacitor configuration
├── package.json         # Dependencies and scripts
├── tailwind.config.js   # Tailwind theme customization
└── vite.config.ts       # Vite configuration
```
