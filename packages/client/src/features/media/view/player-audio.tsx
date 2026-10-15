import { forwardRef } from "react";

/** The hidden audio output; the model drives it through its adapter. */
export const PlayerAudio = forwardRef<
  HTMLAudioElement,
  {
    onEnded(): void;
    onTime(seconds: number): void;
    onDuration(seconds: number): void;
    onFailed(): void;
  }
>(function PlayerAudio({ onEnded, onTime, onDuration, onFailed }, ref) {
  return (
    <audio
      ref={ref}
      data-testid="media.audio"
      onEnded={onEnded}
      onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
      onDurationChange={(e) => onDuration(e.currentTarget.duration)}
      onError={onFailed}
    />
  );
});
