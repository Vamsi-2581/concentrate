import { add, sayHello, times } from "./index";

export function report(): string {
  return `${add(1, 2)} ${times(2, 3)} ${sayHello("core")}`;
}
