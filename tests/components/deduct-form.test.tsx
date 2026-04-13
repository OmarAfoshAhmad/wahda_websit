/// <reference types="vitest/globals" />
import { render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '@/components/toast';
import { DeductForm } from '@/components/deduct-form';
import userEvent from '@testing-library/user-event';
import { getBeneficiaryByCard } from '@/app/actions/beneficiary';
import { deductBalance } from '@/app/actions/deduction';
import { vi } from 'vitest';

// إنشاء نسخ وهمية (Mocks) لدوال الخادم (Server Actions)
vi.mock('@/app/actions/beneficiary', () => ({
  searchBeneficiaries: vi.fn(),
  getBeneficiaryByCard: vi.fn()
}));

vi.mock('@/app/actions/deduction', () => ({
  deductBalance: vi.fn()
}));

describe('DeductForm Component', () => {
  const mockedGetBeneficiaryByCard = vi.mocked(getBeneficiaryByCard);
  const mockedDeductBalance = vi.mocked(deductBalance);
  type MockBeneficiary = {
    id: string;
    name: string;
    card_number: string;
    remaining_balance: number;
    status: 'ACTIVE' | 'INACTIVE' | 'FINISHED';
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('يجب أن يعرض حقل البحث ويتفاعل مع اختصار لوحة المفاتيح', async () => {
    render(
      <ToastProvider>
        <DeductForm />
      </ToastProvider>
    );

    const searchInput = screen.getByPlaceholderText(/أدخل رقم البطاقة أو اسم المستفيد/i);
    expect(searchInput).toBeInTheDocument();

    // النقر خارج الحقل لضمان عدم التركيز عليه
    document.body.focus();
    
    // محاكاة الضغط على Ctrl+K
    await userEvent.keyboard('{Control>}k{/Control}');
    
    // يجب أن يصبح الحقل مركزاً (Focused)
    expect(searchInput).toHaveFocus();
  });

  it('يجب أن يعرض رسالة خطأ عند البحث عن مستفيد غير موجود', async () => {
    // محاكاة استجابة الخادم لعدم وجود مستفيد
    mockedGetBeneficiaryByCard.mockResolvedValueOnce({ error: 'المستفيد غير موجود' });

    render(
      <ToastProvider>
        <DeductForm />
      </ToastProvider>
    );

    const searchInput = screen.getByPlaceholderText(/أدخل رقم البطاقة أو اسم المستفيد/i);
    await userEvent.type(searchInput, '999999{enter}');

    // التحقق من أن الاستعلام ذهب للخادم
    await waitFor(() => {
      expect(getBeneficiaryByCard).toHaveBeenCalledWith('999999');
    });

    // يجب أن تظهر رسالة الخطأ
    expect(await screen.findByText('المستفيد غير موجود')).toBeInTheDocument();
  });

  it('يجب أن يعرض بيانات المستفيد ويسمح بإتمام عملية الخصم بنجاح', async () => {
    // محاكاة العثور على المستفيد بنجاح
    mockedGetBeneficiaryByCard.mockResolvedValueOnce({
      beneficiary: {
        id: '123',
        name: 'أحمد محمود',
        card_number: '123456',
        remaining_balance: 500,
        status: 'ACTIVE' } as MockBeneficiary
    });

    // محاكاة استجابة عملية الخصم
    mockedDeductBalance.mockResolvedValueOnce({
      success: true,
      newBalance: 400
    });

    render(
      <ToastProvider>
        <DeductForm />
      </ToastProvider>
    );

    const searchInput = screen.getByPlaceholderText(/أدخل رقم البطاقة أو اسم المستفيد/i);
    await userEvent.type(searchInput, '123456{enter}');

    // انتظار ظهور بيانات المستفيد
    expect(await screen.findByText('أحمد محمود')).toBeInTheDocument();
    expect(screen.getByText(/123456/)).toBeInTheDocument();

    // إدخال قيمة الخصم
    const amountInput = await screen.findByPlaceholderText('0.00');
    await userEvent.type(amountInput, '100');

    // تأكيد الخصم
    const deductBtn = screen.getByText('مراجعة الخصم');
    await userEvent.click(deductBtn);

    // التحقق من ظهور نافذة التأكيد النهائية
    const confirmFinalBtn = await screen.findByText('تأكيد التنفيذ');
    await userEvent.click(confirmFinalBtn);

    // التحقق من إرسال البيانات بشكل صحيح لدالة الخادم
    await waitFor(() => {
      expect(deductBalance).toHaveBeenCalledWith({
        card_number: '123456',
        amount: 100,
        type: 'SUPPLIES'
      });
    });

    // التحقق من ظهور رسالة النجاح
    expect(await screen.findByText(/تمت عملية الخصم بنجاح/i)).toBeInTheDocument();
  });
});
