/// <reference types="vitest/globals" />
import { render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/toast';
import userEvent from '@testing-library/user-event';

// A test component to trigger toasts
function TestComponent() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('نجاح')}>Success Button</button>
      <button onClick={() => toast.error('خطأ')}>Error Button</button>
    </div>
  );
}

describe('Toast System', () => {
  it('should display success toast when triggered', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const successBtn = screen.getByText('Success Button');
    await userEvent.click(successBtn);

    expect(screen.getByText('نجاح')).toBeInTheDocument();
  });

  it('should display error toast when triggered', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    const errorBtn = screen.getByText('Error Button');
    await userEvent.click(errorBtn);

    expect(screen.getByText('خطأ')).toBeInTheDocument();
  });
});
