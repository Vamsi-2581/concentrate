import { add, sayHello as hello, times } from "@barrel/core";
import * as core from "@barrel/core";

export function run(): string {
  return `${add(1, 2)} ${times(3, 4)} ${hello("app")} ${core.add(5, 6)} ${core.greet("missing")}`;
}
