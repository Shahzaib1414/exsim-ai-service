import {
  BadRequestException,
  HttpStatus,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { extname } from 'path';
import { allowedFileExtension } from '../types';

export function fileExtensionValidator(
  optional: boolean = false,
): PipeTransform {
  return new ParseFileExtension(optional);
}

@Injectable()
export class ParseFileExtension implements PipeTransform {
  private readonly allowedExtensions = allowedFileExtension;
  private readonly optional: boolean;

  constructor(optional: boolean = false) {
    this.optional = optional;
  }

  transform(value: Express.Multer.File): Express.Multer.File | null {
    if (this.optional && !value) {
      return null;
    }
    if (!value || !value.originalname) {
      const errorResponse = {
        status: HttpStatus.BAD_REQUEST,
        message: HttpStatus[HttpStatus.BAD_REQUEST],
        errors: ['File is required', this.allowedExtensions.join(', ')],
      };
      throw new BadRequestException(errorResponse);
    }

    // Normalize the file extension to lowercase
    this.normalizeFileExtension(value);

    const extension = extname(value.originalname).toLowerCase();

    if (!this.allowedExtensions.includes(extension)) {
      const errorResponse = {
        status: HttpStatus.BAD_REQUEST,
        message: HttpStatus[HttpStatus.BAD_REQUEST],
        errors: [`File type ${extension} not supported`],
      };
      throw new BadRequestException(errorResponse);
    }
    return value;
  }

  /**
   * Normalizes the file extension to lowercase by modifying the originalname property
   * @param file - The Express.Multer.File object to normalize
   */
  private normalizeFileExtension(file: Express.Multer.File): void {
    const extension = extname(file.originalname);
    const extensionLower = extension.toLowerCase();

    // Update the file's originalname to have a lowercase extension
    if (extension && file.originalname.endsWith(extension)) {
      const baseName = file.originalname.slice(0, -extension.length);
      file.originalname = baseName + extensionLower;
    }
  }
}
