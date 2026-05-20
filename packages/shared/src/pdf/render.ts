export type RenderPdfPageInput = {
  bytes: Uint8Array;
  pageNumber: number;
  maxEdge?: number;
};

export async function renderPdfPageToWebp(input: RenderPdfPageInput): Promise<Uint8Array> {
  const { pdf } = await import('pdf-to-img');
  const { default: sharp } = await import('sharp');
  const document = await pdf(Buffer.from(input.bytes), { scale: 2 });
  const maxEdge = input.maxEdge ?? 1568;

  let currentPage = 0;
  for await (const pageBuffer of document) {
    currentPage++;
    if (currentPage !== input.pageNumber) continue;

    const image = sharp(pageBuffer);
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const longEdge = Math.max(width, height);

    const resized =
      longEdge > maxEdge
        ? image.resize({
            width: width >= height ? maxEdge : undefined,
            height: height > width ? maxEdge : undefined,
          })
        : image;

    return new Uint8Array(await resized.webp({ quality: 82 }).toBuffer());
  }

  throw new Error(`PDF page ${input.pageNumber} does not exist`);
}
