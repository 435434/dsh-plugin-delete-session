/**
 * dsh-plugin-delete-session — client half.
 *
 * A Module Loader bundle: plain JavaScript, no JSX, no imports (React and every
 * other baseline library comes through the loader's `require`). It contributes
 * one row to the Session "..." menu, asks for an inline confirmation inside that
 * same menu, and posts the request to this package's host half.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-delete-session',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-plugin-delete-session'
    const SLOT = 'sidebar.workspaces.session.menu.item'
    const ROW_ID = 'dsh-plugin-delete-session.delete-session'
    const ROW_ORDER = 500
    const ENDPOINT = '/api/dsh-plugin-delete-session/delete'
    /** The confirm button stays disabled this long, so a double click cannot delete. */
    const ARM_DELAY_MS = 700

    // Theme tokens only: the row follows the active light/dark theme.
    const TEXT_PRIMARY = 'var(--dsw-alias-label-primary)'
    const TEXT_SECONDARY = 'var(--dsw-alias-label-secondary)'
    const SURFACE_HOVER = 'var(--dsw-alias-bg-layer-2)'
    const BORDER_SUBTLE = 'var(--dsw-alias-border-l1)'
    const DANGER = 'var(--dsw-alias-state-error-primary)'
    const WARNING = 'var(--dsw-alias-state-warn-primary)'

    const DICTS = {
      zh: {
        row: '删除会话',
        warning: '删除后不可恢复，会话数据会从磁盘移除。',
        confirm: '确认删除',
        cancel: '取消',
        busy: '正在删除…',
        done: '会话已删除',
        failed: '删除失败',
      },
      en: {
        row: 'Delete session',
        warning: 'This cannot be undone; the session data is removed from disk.',
        confirm: 'Delete',
        cancel: 'Cancel',
        busy: 'Deleting…',
        done: 'Session deleted',
        failed: 'Delete failed',
      },
    }

    function browserDictionary() {
      const language =
        typeof navigator === 'object' && navigator !== null ? String(navigator.language || '') : ''
      return language.toLowerCase().startsWith('zh') ? DICTS.zh : DICTS.en
    }

    function trashIcon() {
      return h(
        'svg',
        {
          width: 15,
          height: 15,
          viewBox: '0 0 16 16',
          'aria-hidden': 'true',
          style: { flex: '0 0 auto', display: 'block' },
        },
        h('path', {
          d: 'M6 2.75h4M2.75 4.75h10.5M4.2 4.75l.55 8.05a1.5 1.5 0 0 0 1.5 1.4h3.5a1.5 1.5 0 0 0 1.5-1.4l.55-8.05',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6.75 7.4v4M9.25 7.4v4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      )
    }

    function rowStyle(hover) {
      return {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxSizing: 'border-box',
        width: '100%',
        margin: '0',
        padding: '7px 10px',
        border: 'none',
        borderTop: '1px solid ' + BORDER_SUBTLE,
        borderRadius: '6px',
        background: hover ? SURFACE_HOVER : 'transparent',
        color: TEXT_PRIMARY,
        font: 'inherit',
        fontSize: '14px',
        lineHeight: '20px',
        textAlign: 'left',
        cursor: 'pointer',
      }
    }

    function actionStyle(kind, hover, disabled) {
      const style = {
        boxSizing: 'border-box',
        padding: '5px 10px',
        borderRadius: '6px',
        border: '1px solid ' + BORDER_SUBTLE,
        background: 'transparent',
        color: TEXT_PRIMARY,
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '18px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : hover ? 0.86 : 1,
      }
      if (kind === 'danger') {
        style.border = '1px solid transparent'
        style.background = DANGER
        style.color = '#ffffff'
        style.fontWeight = '500'
      } else if (hover) {
        style.background = SURFACE_HOVER
      }
      return style
    }

    const statusStyle = (color) => ({
      boxSizing: 'border-box',
      width: '100%',
      padding: '8px 10px',
      borderTop: '1px solid ' + BORDER_SUBTLE,
      color,
      fontSize: '12px',
      lineHeight: '16px',
      wordBreak: 'break-word',
    })

    const fieldStyle = {
      flex: '1 1 auto',
      minWidth: '0',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }

    /** The row component, closed over the package's translator. */
    function createRow(translate) {
      function text(key) {
        try {
          const value = translate(key)
          if (typeof value === 'string' && value.length > 0 && value !== key) return value
        } catch (cause) {
          // Fall through to the browser-language dictionary.
        }
        const dict = browserDictionary()
        return typeof dict[key] === 'string' ? dict[key] : key
      }

      return function DeleteSessionRow(props) {
        // Injected by the slot (hookContext: MenuOpenState).
        const menuState =
          typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : null
        const setMenuOpen =
          Array.isArray(menuState) && typeof menuState[1] === 'function' ? menuState[1] : null
        const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''

        const [phase, setPhase] = React.useState('idle') // idle | confirm | busy | done | error
        const [message, setMessage] = React.useState('')
        const [armed, setArmed] = React.useState(false)
        const [hoverKey, setHoverKey] = React.useState('')

        React.useEffect(() => {
          if (phase !== 'confirm') return undefined
          const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS)
          return () => clearTimeout(timer)
        }, [phase])

        const closeMenu = () => {
          if (setMenuOpen !== null) setMenuOpen(false)
        }

        const startDelete = async () => {
          setMessage('')
          setPhase('busy')
          try {
            const response = await fetch(ENDPOINT, {
              method: 'POST',
              headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'x-dsh-plugin': NS,
              },
              body: JSON.stringify({ sessionId, confirmed: true }),
            })
            let payload = null
            try {
              payload = await response.json()
            } catch (cause) {
              payload = null
            }
            if (response.ok !== true || payload === null || payload.ok !== true) {
              const reason =
                payload !== null && typeof payload.error === 'string'
                  ? payload.error
                  : 'HTTP ' + String(response.status)
              throw new Error(reason)
            }
            setPhase('done')
            closeMenu()
          } catch (cause) {
            setMessage(cause instanceof Error ? cause.message : String(cause))
            setPhase('error')
          }
        }

        if (phase === 'idle' || phase === 'done') {
          const label = phase === 'done' ? text('done') : text('row')
          return h(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              title: label,
              style: rowStyle(hoverKey === 'row'),
              onMouseEnter: () => setHoverKey('row'),
              onMouseLeave: () => setHoverKey(''),
              onClick: () => {
                setArmed(false)
                setPhase('confirm')
              },
            },
            trashIcon(),
            h('span', { style: fieldStyle }, label),
          )
        }

        if (phase === 'confirm') {
          return h(
            'div',
            {
              style: {
                boxSizing: 'border-box',
                width: '100%',
                padding: '8px 10px',
                borderTop: '1px solid ' + BORDER_SUBTLE,
                color: TEXT_PRIMARY,
              },
            },
            h(
              'div',
              { style: { color: WARNING, fontSize: '12px', lineHeight: '16px' } },
              text('warning'),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
              h(
                'button',
                {
                  type: 'button',
                  role: 'menuitem',
                  style: actionStyle('neutral', hoverKey === 'cancel', false),
                  onMouseEnter: () => setHoverKey('cancel'),
                  onMouseLeave: () => setHoverKey(''),
                  onClick: () => {
                    setArmed(false)
                    setPhase('idle')
                  },
                },
                text('cancel'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  role: 'menuitem',
                  disabled: !armed,
                  style: actionStyle('danger', hoverKey === 'confirm', !armed),
                  onMouseEnter: () => setHoverKey('confirm'),
                  onMouseLeave: () => setHoverKey(''),
                  onClick: () => {
                    if (armed) void startDelete()
                  },
                },
                text('confirm'),
              ),
            ),
          )
        }

        if (phase === 'busy') {
          return h('div', { style: statusStyle(TEXT_SECONDARY) }, text('busy'))
        }

        return h(
          'div',
          { style: statusStyle(DANGER) },
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' } },
            h('span', null, text('failed') + ': ' + (message.length > 0 ? message : 'unknown error')),
            h(
              'button',
              {
                type: 'button',
                role: 'menuitem',
                style: actionStyle('neutral', hoverKey === 'retry', false),
                onMouseEnter: () => setHoverKey('retry'),
                onMouseLeave: () => setHoverKey(''),
                onClick: () => {
                  setArmed(false)
                  setPhase('idle')
                },
              },
              text('row'),
            ),
          ),
        )
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const Row = createRow((key) => ctx.locale.bind(NS)(key))

        ctx.effect(() => {
          const disposers = []
          for (const locale of ['zh', 'zh-CN', 'en', 'en-US']) {
            try {
              const dispose = ctx.locale.register(NS, locale, locale.startsWith('zh') ? DICTS.zh : DICTS.en)
              if (typeof dispose === 'function') disposers.push(dispose)
            } catch (cause) {
              // An unknown locale id only costs the localized text; the row
              // still reads from the browser-language dictionary.
            }
          }
          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch (cause) {
                // already released
              }
            }
          }
        }, NS + ': dictionaries')

        ctx.slots.inject(SLOT, () =>
          ctx.slots.register(
            {
              name: SLOT,
              id: ROW_ID,
              order: ROW_ORDER,
              locale: NS,
              label: () => {
                try {
                  return ctx.locale.bind(NS)('row')
                } catch (cause) {
                  return browserDictionary().row
                }
              },
            },
            Row,
          ),
        )
      },
    }
  },
})
