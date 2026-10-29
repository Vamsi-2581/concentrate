import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Photo } from './photo.entity'

export class PhotosService {
  constructor(@InjectRepository(Photo) private readonly photoRepository: Repository<Photo>) {}

  list() {
    return this.photoRepository.find()
  }

  add(url: string) {
    return this.photoRepository.save({ url })
  }
}
