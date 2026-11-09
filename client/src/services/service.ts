import {inject, provide, type InjectionKey} from 'vue'

/**
 * A service of the shell or of a project: made once where it belongs (App, ProjectLayout), handed down by provide/inject. No module-wide
 * singletons: what has a timer or a connection lives exactly as long as the component that made it.
 */
export function defineService<T>(name: string) {
  const key: InjectionKey<T> = Symbol(name)
  return {
    provide: (value: T) => {
      provide(key, value)
      return value
    },
    use: (): T => {
      const value = inject(key)
      if (value === undefined) throw new Error(`${name} is not provided here`)
      return value
    },
  }
}
