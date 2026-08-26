# Conventions - BillItUp

## Coding Standards
- **Language**: TypeScript for all logic.
- **Component Pattern**: Functional components with Hooks.
- **State**: Favor React Context for global state (Theme, Auth, Alerts).
- **Styling**: Utility-first CSS with Tailwind. Custom tokens defined in `tailwind.config.js` and `index.css`.
- **Naming**: 
  - PascalCase for Components and Contexts.
  - camelCase for functions and variables.
  - kebab-case for CSS classes and file names (except for Components).

## UI/UX Principles
- **Premium Feel**: Use `framer-motion` for all transitions and interactions.
- **Micro-interactions**: Haptic feedback on button presses.
- **Material Design 3**: Leveraging MD3 color palettes and spacing.
- **Performance**: High-fidelity easing and staggered animations.
