// Only reviewed synthetic artifacts can pass deterministic processing.
// These pins identify a 1x1 PNG, a 2x1 JPEG and a one-page unencrypted PDF.
export const syntheticSamples = [
  {
    mime: 'image/png',
    size: 69,
    digest: 'b75368e414a64c223ffb18fef090a45ff203704613e11bdb922757ac5b00ee06',
  },
  {
    mime: 'image/jpeg',
    size: 659,
    digest: 'e07c45fd369a2991a8b97428c12cef6966a92f3c101f1ed5d7efe58cb75559cb',
  },
  {
    mime: 'application/pdf',
    size: 601,
    digest: '1dbe95fd6e5b3f6c29b07755b6a1ed2c4e250fba4ba39b36f67113e9d743de04',
  },
] as const;
