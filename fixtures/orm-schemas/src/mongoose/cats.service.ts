import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Cat } from './cat.schema'

export class CatsService {
  constructor(@InjectModel(Cat.name) private catModel: Model<Cat>) {}

  findAll() {
    return this.catModel.find()
  }

  create(name: string) {
    return this.catModel.create({ name })
  }
}
