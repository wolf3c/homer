import {useEffect, useState} from 'react';
import {Dialog} from '@base-ui/react/dialog';
import {useMediaQuery} from '@mantine/hooks';
import {X} from 'lucide-react';

type FeatureTourBridge = {
  pending(): Promise<boolean>;
  dismiss(): Promise<void>;
};

declare global {
  interface Window {
    homerDesktopFeatureTour?: FeatureTourBridge;
  }
}

const scenes = [
  {
    asset: 'legion',
    title: 'Homer 统驭AI军团',
    description: '用户向 Homer 发送四条消息。四位机器人助手并行工作，逐一打勾并把结果传回 Homer，最后显示 4 项完成。',
  },
  {
    asset: 'annotation',
    title: '批注让表达更直接更准确',
    description: '截取浏览器窗口，拖出矩形并写下批注。点发送后，截图飞向 Homer。他敬礼说「收到！」，然后拔剑向前冲，表示开始行动。',
    concept: true,
  },
  {
    asset: 'mobile',
    title: '手机app + 聊天工具，随时给Homer派活',
    description: '一只手依次从 Homer App、微信、Telegram 和钉钉的图标旁伸出，把纸团抛到 Homer 桌上。每个纸团一落桌，Homer 就捡起来展开查看，再朝发来消息的应用敬礼说「收到！」，随后继续伏案写字。',
  },
];

export function DesktopFeatureTour({bridge, ready, settingsActive, returnFocus}: {
  bridge: FeatureTourBridge;
  ready: boolean;
  settingsActive: boolean;
  returnFocus: () => HTMLElement | null;
}) {
  const [open, setOpen] = useState<boolean>();

  useEffect(() => {
    if (!ready || settingsActive || open !== undefined) return;
    let active = true;
    void bridge.pending().then(pending => {
      if (active) setOpen(pending === true);
    }).catch(() => {
      if (active) setOpen(false);
    });
    return () => { active = false; };
  }, [bridge, open, ready, settingsActive]);

  function dismiss() {
    setOpen(false);
    void bridge.dismiss().catch(() => {});
  }

  return <FeatureTourDialog open={open === true && !settingsActive}
    onDismiss={dismiss} returnFocus={settingsActive ? false : returnFocus} />;
}

export function FeatureTourDialog({open, onDismiss, onOpenChangeComplete, returnFocus}: {
  open: boolean;
  onDismiss: () => void;
  onOpenChangeComplete?: (open: boolean) => void;
  returnFocus: false | (() => HTMLElement | null);
}) {
  return <Dialog.Root open={open} disablePointerDismissal
    onOpenChange={next => { if (!next) onDismiss(); }} onOpenChangeComplete={onOpenChangeComplete}>
    <Dialog.Portal>
      <Dialog.Backdrop className="desktop-feature-tour-backdrop" />
      <Dialog.Popup className="desktop-feature-tour" finalFocus={returnFocus}>
        <Dialog.Close className="desktop-feature-tour-close" aria-label="关闭弹窗" title="关闭"><X size={18} /></Dialog.Close>
        <FeatureTourSlides onDismiss={onDismiss} />
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

function FeatureTourSlides({onDismiss}: {onDismiss: () => void}) {
  const [index, setIndex] = useState(0);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', undefined, {getInitialValueInEffect: false});
  const [playing, setPlaying] = useState(!reducedMotion);
  useEffect(() => { setPlaying(!reducedMotion); }, [reducedMotion]);

  const scene = scenes[index]!;
  const last = index === scenes.length - 1;
  const playbackLabel = playing ? '暂停动图' : '播放动图';

  return <>
    <figure className="desktop-feature-tour-slide">
      <figcaption><Dialog.Title className="desktop-feature-tour-title" aria-live="polite">{scene.title}</Dialog.Title></figcaption>
      <img key={index} className="desktop-feature-tour-image" data-motion={playing && !reducedMotion || undefined}
        width={1200} height={614} alt={scene.description}
        src={`${import.meta.env.BASE_URL}assets/desktop-feature-tour-v1-${scene.asset}.${playing ? 'gif' : 'png'}`} />
      {scene.concept && <span className="desktop-feature-tour-concept">体验示意</span>}
    </figure>
    <button type="button" className="desktop-feature-tour-playback" aria-label={playbackLabel} title={playbackLabel}
      data-paused={!playing || undefined} onClick={() => setPlaying(value => !value)} />
    <div className="desktop-feature-tour-pages" role="group" aria-label="选择演示页">
      {scenes.map(({asset, title}, page) => <button key={asset} type="button" aria-label={title}
        aria-pressed={page === index} onClick={() => setIndex(page)} />)}
    </div>
    <button type="button" className="desktop-feature-tour-next"
      onClick={() => last ? onDismiss() : setIndex(index + 1)}>{last ? '完成' : '下一项'}</button>
  </>;
}
