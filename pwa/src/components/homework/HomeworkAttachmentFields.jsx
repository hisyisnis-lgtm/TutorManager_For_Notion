import { Children } from 'react';
import {
  MicrophoneIcon, PaperclipIcon, PlusIcon, XIcon,
} from '@phosphor-icons/react';
import { Button } from '../shadcn/button';
import SectionEntryButton from '../ui/SectionEntryButton.jsx';
import { MAX_FILES, MAX_TOTAL_FILE_MB } from '../../utils/homeworkLimits.js';
import { MAX_FILE_MB } from '../../utils/audioFile.js';

/** 강사 출제·피드백의 첨부 동작과 파일 행. 실제 전송은 최종 저장에서 수행한다. */
export default function HomeworkAttachmentFields({ attach, files, onRemove, disabled, count, children }) {
  const maxFiles = attach.maxFiles ?? MAX_FILES;
  const actions = [
    { label: '녹음하기', Icon: MicrophoneIcon, onClick: attach.tryOpenRecord },
    { label: '파일 추가', Icon: PaperclipIcon, onClick: attach.tryOpenFilePicker },
  ];

  return (
    <section aria-label="첨부 파일">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          최대 {maxFiles}개 · 파일당 {MAX_FILE_MB}MB · 총 {MAX_TOTAL_FILE_MB}MB
        </p>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground"
          role={disabled ? undefined : 'status'} aria-live={disabled ? undefined : 'polite'} aria-atomic="true"
          aria-label={`첨부 파일 ${count}개, 최대 ${maxFiles}개`}>
          {count}/{maxFiles}
        </span>
      </div>
      <div className="space-y-3">
        {actions.map(({ label, Icon, onClick }) => (
          <SectionEntryButton key={label}
            icon={<Icon size={24} className="text-muted-foreground" aria-hidden />}
            label={<><span className="flex-1 text-left">{label}</span><PlusIcon size={20} className="text-muted-foreground" aria-hidden /></>}
            onClick={onClick} disabled={disabled || count >= maxFiles}
            className="mb-0 h-14 justify-start gap-3 border-input bg-card px-4 text-foreground hover:bg-accent"
          />
        ))}
      </div>
      {(Children.count(children) > 0 || files.length > 0) && (
        <ul className="mt-6 border-t border-border" aria-label="첨부할 파일 목록">
          {children}
          {files.map((file) => {
            const name = file.baseName + file.ext;
            return (
              <li key={file.tempId} className="flex min-h-14 items-center gap-3 border-b border-border py-1 last:border-b-0">
                <PaperclipIcon size={20} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{name}</span>
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground"
                  onClick={() => onRemove(file.tempId)} disabled={disabled} aria-label={`${name} 삭제`}>
                  <XIcon size={16} aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
