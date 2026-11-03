// Lucide SVG paths from the approved composer design bundle.
// ISC / Feather MIT notices: public/composer-icons.LICENSE.txt (included in the web build).
const paths = {
  paperclip: <path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" />,
  arrow: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
  square: <rect width="18" height="18" x="3" y="3" rx="2" />,
};

export function ComposerIcon({name}: {name: keyof typeof paths}) {
  return <svg className="composer-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
