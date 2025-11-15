# Toilet Map Admin Explorer

A fully-featured admin interface for managing the Toilet Map database.

## Features

### 🔐 Authentication
- **Auth0 Integration**: Secure OAuth2 implicit flow authentication
- **Role-Based Access**: Only users with Admin role (`rol_aC7YZZenLUd5kh9X`) can access
- **Token Management**: Automatic token storage and refresh handling
- **Session Persistence**: Login state persists across browser sessions

### 📋 Loo List View
- **Paginated Search**: Browse all loos with customizable page size (20 items/page)
- **Advanced Filtering**: Filter by active status, accessibility, and verification
- **Full-Text Search**: Search by name, area, or notes
- **Batch Operations**: Quick delete with confirmation
- **Status Indicators**: Visual badges for active/inactive status
- **Feature Icons**: Quick view of loo features (accessible, baby change, RADAR, free)

### ✏️ Loo Editor
- **Create & Update**: Full CRUD operations for loo records
- **Comprehensive Fields**: All loo attributes editable
  - Basic info: Name, location (lat/lng)
  - Status: Active/inactive
  - Accessibility: Accessible, RADAR key, baby change
  - Gender facilities: Men, women, all-gender
  - Features: Attended, automatic, children, urinal only, free
  - Additional: Payment details, notes, removal reason
- **Smart Form Handling**: Proper checkbox state management
- **Validation**: Client-side validation before submission
- **Auto-navigation**: Redirects to edit view after creation

### 📜 Report History Timeline
- **Audit Trail**: Complete history of all changes to a loo
- **Diff Visualization**: See exactly what changed in each edit
- **Contributor Tracking**: View who made each change
- **System vs User**: Distinguish between system and user-generated reports
- **Chronological View**: Timeline UI with visual indicators
- **Expandable**: Toggle history panel in editor view

### 🗺️ Map View
- **Interactive Map**: Leaflet-powered map interface
- **OpenStreetMap Tiles**: High-quality map rendering
- **Color-Coded Markers**: Green (active) and red (inactive)
- **Rich Popups**: Click markers for detailed loo information
- **Quick Actions**: View details button in popup
- **Auto-Fit Bounds**: Automatically zoom to show all markers
- **Filterable**: Filter map by active status and accessibility
- **Performance**: Loads up to 200 loos with locations

## Architecture

### Technology Stack
- **Vanilla JavaScript**: No frameworks, pure ES6+ modules
- **Web Components**: Custom elements for modularity
- **Leaflet.js**: Map visualization (loaded from CDN)
- **Auth0**: Authentication provider
- **CSS Custom Properties**: Themeable design system

### Component Structure

```
admin-app (Main Shell)
├── admin-sidebar (Navigation)
├── loo-list (List View)
│   ├── Search & Filters
│   └── Pagination Controls
├── loo-editor (Edit/Create View)
│   ├── Form Fields
│   └── report-timeline (History)
└── loo-map (Map View)
    ├── Leaflet Map
    └── Markers & Popups
```

### Services
- **AuthService**: Manages Auth0 authentication and tokens
- **ApiService**: Handles all HTTP requests to the backend
- **EventBus**: Component communication via pub/sub pattern
- **Toast**: User feedback notifications

## Design System

### Colors
- Primary: `#2563eb` (Blue)
- Success: `#10b981` (Green)
- Danger: `#ef4444` (Red)
- Warning: `#f59e0b` (Orange)

### Typography
- Font: System font stack for optimal performance
- Scale: 0.75rem - 1.5rem

### Spacing
- Base unit: 0.25rem (4px)
- Border radius: sm (0.375rem), md (0.5rem), lg (0.75rem)

### Shadows
- sm: Subtle elevation
- md: Medium elevation
- lg: High elevation (modals, toasts)

## Configuration

The admin explorer is configured via environment variables injected at runtime:

```env
AUTH0_DATA_EXPLORER_CLIENT_ID=your_client_id
AUTH0_DATA_EXPLORER_REDIRECT_URI=http://localhost:4001/admin
AUTH0_DATA_EXPLORER_SCOPE=openid profile email
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.toiletmap.org.uk
```

## File Structure

```
admin-explorer/
├── index.html          # Single-file application
└── README.md          # This file
```

## Development

The admin explorer is a **single-file application** with no build step required. All code is contained in `index.html`:

1. **Global Styles**: CSS custom properties and base styles
2. **Services**: Auth, API, EventBus, Toast utilities
3. **Components**: Web components for each view
4. **App Bootstrap**: Initialization code

### Making Changes

1. Edit `admin-explorer/index.html`
2. Refresh browser (no build needed)
3. Test changes
4. Commit

### Adding New Features

1. Add component class definition in the script section
2. Register with `customElements.define()`
3. Add to routing in `AdminApp.renderView()`
4. Add navigation button to sidebar if needed

## Browser Support

- Modern browsers with ES6+ support
- Web Components API support
- LocalStorage API
- Fetch API

## Security

- **Authentication Required**: All routes require valid Auth0 token
- **Role-Based Access**: Admin role check on every page load
- **XSS Protection**: All user input is escaped
- **Token Expiry**: Tokens expire and require re-authentication
- **HTTPS**: Should only be served over HTTPS in production

## Performance

- **Lazy Loading**: Components only render when activated
- **Efficient Updates**: Minimal DOM manipulation
- **CDN Resources**: Leaflet loaded from CDN (cached)
- **No Bundle**: Direct ES6 modules, no build overhead
- **Pagination**: Lists limited to 20 items for performance

## Accessibility

- **Semantic HTML**: Proper heading hierarchy
- **Form Labels**: All inputs properly labeled
- **Keyboard Navigation**: All interactive elements keyboard accessible
- **Focus Indicators**: Clear focus states
- **Color Contrast**: WCAG AA compliant

## Future Enhancements

Potential improvements:
- Bulk operations (multi-select delete/edit)
- Export functionality (CSV, JSON)
- Advanced analytics dashboard
- Keyboard shortcuts
- Dark mode support
- Image upload for loos
- Opening hours editor (currently JSON)
- Area management interface
- User management (if needed)
