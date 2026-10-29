export default class Client {
  constructor(private base: string) {}
  static create(base: string): Client { return new Client(base); }
}
export class Derived extends Client {}
