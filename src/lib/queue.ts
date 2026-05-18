/**
 * Queue Stub (In-Memory Mode)
 * ===========================
 * تم تعطيل BullMQ و Redis نهائياً.
 * النظام الآن يعتمد على المعالجة المباشرة (Direct Processing) لعمليات الاستيراد.
 */

// نوع Job Data لاستيراد المستفيدين
export interface ImportJobData {
  jobId: string;
  username: string;
}

export interface TransactionImportJobData {
  jobId: string;
  username: string;
}

/**
 * تعطيل الطوابير وإجبار النظام على المعالجة المباشرة
 */
export async function getImportQueue() {
  return null;
}

export async function getTransactionImportQueue() {
  return null;
}

/**
 * يعيد دائماً false لإخبار النظام باستخدام المعالجة المباشرة (Fallback)
 */
export async function enqueueImportJob(jobId: string, username: string): Promise<boolean> {
  return false; 
}

export async function enqueueTransactionImportJob(jobId: string, username: string): Promise<boolean> {
  return false;
}

/**
 * Workers معطلة في نمط الذاكرة المحلية
 */
export async function startImportWorker() {
  return null;
}

export async function startTransactionImportWorker() {
  return null;
}
