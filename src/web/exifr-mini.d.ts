// exifr's mini build reads the EXIF block of JPEG and HEIC files, which is
// all photo.ts needs; it shares the full build's API and types.
declare module 'exifr/dist/mini.esm.mjs' {
  export { default } from 'exifr';
}
