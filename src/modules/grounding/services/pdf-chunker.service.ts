import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { TPdfChunk, TErrorResult } from '@/common/types';
import { serializeError } from '@/utils';
import { PDFParse } from 'pdf-parse';

@Injectable()
export class PdfChunkerService {
  constructor(
    @InjectPinoLogger(PdfChunkerService.name)
    private readonly logger: PinoLogger,
  ) {}

  async parseAndChunk(
    buffer: Buffer,
    fileName: string,
    chunkSize = 500,
    overlap = 50,
  ): Promise<Result<TPdfChunk[], TErrorResult>> {
    try {
      const data = new PDFParse({ data: buffer });
      const textResult = await data.getText();
      const rawText = textResult.text;

      const chunks = this.splitIntoChunks(rawText, chunkSize, overlap);

      return ok(
        chunks.map((text) => ({
          text,
          pageNumber: null,
          sourceDoc: fileName,
        })),
      );
    } catch (error) {
      this.logger.error({
        message: 'Failed to parse PDF',
        data: { fileName, error: serializeError(error) },
      });
      return err({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'failed to parse PDF',
      });
    }
  }

  private splitIntoChunks(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    const paragraphs = text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const segments: string[] = [];
    for (const paragraph of paragraphs) {
      if (paragraph.length <= chunkSize) {
        segments.push(paragraph);
      } else {
        // Split long paragraphs on sentence boundaries
        const sentences = paragraph
          .split(/(?<=\. )/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        let current = '';
        for (const sentence of sentences) {
          if ((current + ' ' + sentence).trim().length > chunkSize && current) {
            segments.push(current.trim());
            current = sentence;
          } else {
            current = current ? `${current} ${sentence}` : sentence;
          }
        }
        if (current.trim()) segments.push(current.trim());
      }
    }

    // Apply sliding overlap between adjacent segments
    const chunks: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      if (i === 0) {
        chunks.push(segments[i]);
      } else {
        const prev = segments[i - 1];
        const tail = prev.slice(-overlap);
        chunks.push(`${tail} ${segments[i]}`.trim());
      }
    }

    return chunks.filter((c) => c.length > 0);
  }
}
