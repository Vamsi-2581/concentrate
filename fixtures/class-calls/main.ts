import { HttpException, NotFound, Plain } from './errors';
import { Http } from './index';
import Client, { Derived } from './client';
class Local { constructor() {} static make(): Local { return new Local(); } }
export function run() {
  new HttpException(404, 'x');
  new NotFound(404, 'y');
  new Plain();
  new Http(500, 'z');
  Client.create('a');
  Derived.create('b');
  new Local();
  Local.make();
  new Map();
}
