import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(1, "Username is required").max(50, "اسم المستخدم طويل جداً"),
  password: z.string().min(1, "Password is required").max(128, "كلمة المرور طويلة جداً"),
});

export const deductionSchema = z.object({
  card_number: z.string().min(1, "رقم البطاقة مطلوب").max(50, "رقم البطاقة طويل جداً"),
  amount: z.coerce.number().positive("يجب أن يكون المبلغ أكبر من الصفر").max(999_999, "المبلغ كبير جداً"),
  type: z.enum(["MEDICINE", "SUPPLIES"], {
    message: "يرجى اختيار نوع العملية",
  }),
});

export const createFacilitySchema = z.object({
  name: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل").max(100, "الاسم طويل جداً"),
  username: z
    .string()
    .min(3, "اسم المستخدم يجب أن يكون 3 أحرف على الأقل")
    .max(50, "اسم المستخدم طويل جداً")
    .regex(/^[a-z0-9_]+$/, "اسم المستخدم يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط"),
  password: z
    .string()
    .min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل")
    .max(128, "كلمة المرور طويلة جداً")
    .optional(),
});

export const updateFacilitySchema = z.object({
  id: z.string().min(1, "معرف المرفق مطلوب"),
  name: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل").max(100, "الاسم طويل جداً"),
  username: z
    .string()
    .min(3, "اسم المستخدم يجب أن يكون 3 أحرف على الأقل")
    .max(50, "اسم المستخدم طويل جداً")
    .regex(/^[a-z0-9_]+$/, "اسم المستخدم يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط"),
});

export const changePasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل")
    .max(128, "كلمة المرور طويلة جداً")
    .regex(/[A-Z]/, "يجب أن تحتوي على حرف كبير على الأقل")
    .regex(/[0-9]/, "يجب أن تحتوي على رقم على الأقل"),
  confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب").max(128, "كلمة المرور طويلة جداً"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "كلمتا المرور غير متطابقتين",
  path: ["confirmPassword"],
});

export const voluntaryChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "كلمة المرور الحالية مطلوبة").max(128, "كلمة المرور طويلة جداً"),
  newPassword: z
    .string()
    .min(8, "كلمة المرور يجب أن تكون 8 أحرف على الأقل")
    .max(128, "كلمة المرور طويلة جداً")
    .regex(/[A-Z]/, "يجب أن تحتوي على حرف كبير على الأقل")
    .regex(/[0-9]/, "يجب أن تحتوي على رقم على الأقل"),
  confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب").max(128, "كلمة المرور طويلة جداً"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "كلمتا المرور غير متطابقتين",
  path: ["confirmPassword"],
});

export const updateBeneficiarySchema = z.object({
  id: z.string().min(1, "معرف المستفيد مطلوب"),
  name: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل").max(100, "الاسم طويل جداً"),
  card_number: z.string().min(3, "رقم البطاقة غير صالح").max(50, "رقم البطاقة طويل جداً"),
  birth_date: z.string().max(20, "تاريخ غير صالح").optional(),
  status: z.enum(["ACTIVE", "FINISHED", "SUSPENDED"], {
    message: "حالة المستفيد غير صحيحة",
  }),
});

export type CreateFacilityInput = z.infer<typeof createFacilitySchema>;
export type UpdateFacilityInput = z.infer<typeof updateFacilitySchema>;
