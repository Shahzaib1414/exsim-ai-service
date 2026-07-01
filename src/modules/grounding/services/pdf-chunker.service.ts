import { HttpStatus, Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PDFParse } from 'pdf-parse';

import { TPdfChunk, TErrorResult } from '@/common/types';
import { serializeError } from '@/utils';

@Injectable()
export class PdfChunkerService {
  constructor(
    @InjectPinoLogger(PdfChunkerService.name)
    private readonly logger: PinoLogger,
  ) {}

  async parseAndChunk(
    buffer: Buffer,
    fileName: string,
  ): Promise<Result<TPdfChunk[], TErrorResult>> {
    try {
      const data = new PDFParse({ data: buffer });
      const result = await data.getText();

      const chunks: TPdfChunk[] = result.pages
        .map((page: { text: string; num: number }) => ({
          text: page.text.replace(/\s+/g, ' ').trim(),
          pageNumber: page.num,
          sourceDoc: fileName,
        }))
        .filter((chunk: TPdfChunk) => chunk.text.length > 0);

      return ok(chunks);
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
}
