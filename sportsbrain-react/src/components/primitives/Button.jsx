/* Button — v8 primitive
 * variants: primary | secondary | ghost | ghost-edge | danger
 * sizes:    sm | md | lg
 * iconOnly: bool — square icon button
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  leftIcon = null,
  rightIcon = null,
  children,
  className = '',
  ...rest
}) {
  const cls = [
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    iconOnly && 'btn--icon',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button className={cls} {...rest}>
      {leftIcon && <span className="btn__icon">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="btn__icon">{rightIcon}</span>}
    </button>
  )
}

export default Button
