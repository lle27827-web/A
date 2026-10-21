export const sampleMemberBatchSize = 1000;
export const sampleMemberBatchConfirmation = "TAO_1000_NHAN_VIEN_MAU";

export function buildSampleMemberNames(): string[] {
  return Array.from(
    { length: sampleMemberBatchSize },
    (_, index) => `Nhân viên ${index + 1}`,
  );
}
