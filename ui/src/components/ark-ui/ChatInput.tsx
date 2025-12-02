import { Field } from '@ark-ui/solid/field'
import { createSignal } from 'solid-js'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export const ChatInput = (props: ChatInputProps) => {
  const [value, setValue] = createSignal('')

  const handleSend = () => {
    const message = value().trim()
    if (message && !props.disabled) {
      props.onSend(message)
      setValue('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Field.Root w="full">
      <Field.Textarea
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        autoresize
        placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
        disabled={props.disabled}
        border="1 dark-border-secondary focus:neon-cyan"
        rounded="lg"
        p="3"
        resize="none"
        min-h="12"
        max-h="48"
        w="full"
        text="sm dark-text-primary"
        bg="dark-bg-tertiary"
        disabled:opacity="50"
        disabled:cursor="not-allowed"
        outline="none"
        ring="2 transparent focus:neon-cyan/20"
        transition="all"
      />
      <Field.HelperText text="xs dark-text-tertiary" m="t-1">
        Enter to send • Shift+Enter for new line
      </Field.HelperText>
    </Field.Root>
  )
}
