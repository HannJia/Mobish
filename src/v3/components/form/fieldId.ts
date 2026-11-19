import { inject, type InjectionKey } from 'vue'

/** V3Field 提供给内部控件的 id，用来把标签和控件关联起来。 */
export const FIELD_ID: InjectionKey<string> = Symbol('v3-field-id')

export function useFieldId() {
  return inject(FIELD_ID, undefined)
}
