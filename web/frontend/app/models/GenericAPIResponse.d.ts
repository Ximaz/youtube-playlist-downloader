export interface GenericAPIResponse<T> {
  status: string;
  message: stirng | null;
  data: T | null;
}
