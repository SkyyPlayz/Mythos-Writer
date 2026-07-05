// Static asset imports (Vite serves these; TS needs the module shapes).
declare module '*.webp' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
