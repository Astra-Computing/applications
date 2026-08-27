type WaveBannerProps = {
  variant: 'hero' | 'slim';
  flip?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export default function WaveBanner({ variant, flip = false, className = '', children }: WaveBannerProps) {
  const classes = [
    'wave-banner',
    `wave-banner-${variant}`,
    flip ? 'wave-banner-flip' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      <div className="wave-layer wave-layer-light" aria-hidden="true" />
      <div className="wave-layer wave-layer-medium" aria-hidden="true" />
      <div className="wave-layer wave-layer-dark" aria-hidden="true" />
      {children}
    </div>
  );
}
