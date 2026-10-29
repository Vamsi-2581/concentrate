import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import * as mongoose from 'mongoose'

@Schema({ collection: 'felines' })
export class Owner {
  @Prop({ required: true, unique: true })
  name: string
}

@Schema()
export class Cat {
  @Prop({ required: true })
  name: string

  @Prop()
  age?: number

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Owner' })
  owner: Owner

  @Prop([String])
  tags: string[]
}

export const CatSchema = SchemaFactory.createForClass(Cat)
