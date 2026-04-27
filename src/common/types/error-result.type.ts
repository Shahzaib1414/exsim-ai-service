import { ErrorHttpStatusCode } from '@ts-rest/core';

export type TErrorResult = {
  status: ErrorHttpStatusCode;
  message: string;
};
