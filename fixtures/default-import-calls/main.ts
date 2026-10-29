import generateToken from './token';
import named from './named';
import aliased from './alias';
import { fromBarrel } from './barrel';
import viaBarrelDefault from './barrel';
import instance from './factory';
export function run() {
  generateToken(1);
  named();
  aliased();
  fromBarrel(2);
  viaBarrelDefault();
  instance();
}
