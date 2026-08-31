import { toast } from 'sonner';

let errorToastId: string | number | undefined;

/** 请求层和页面可能同时上报同一次失败，复用 ID 更新提示，避免重复堆叠。 */
export function notifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const id = toast.error('操作失败', {
    id: errorToastId,
    duration: Infinity,
    onDismiss: () => {
      if (errorToastId === id) errorToastId = undefined;
    },
    description: (
      // 保留 Sonner 的标准外观和交互；长错误在内容区滚动，不撑宽页面或遮住关闭按钮。
      <p tabIndex={0} className="max-h-[50dvh] overflow-y-auto whitespace-pre-wrap wrap-anywhere">
        {message}
      </p>
    ),
  });
  errorToastId = id;
}

export function clearFeedback() {
  // 新一轮操作使用新 ID，避免旧提示的退出动画删除刚返回的新错误。
  if (errorToastId !== undefined) toast.dismiss(errorToastId);
  errorToastId = undefined;
}
