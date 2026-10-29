import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, ViewEntity } from 'typeorm'
import { Photo } from './photo.entity'

@Entity({ name: 'app_users', schema: 'auth' })
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ name: 'email_address', unique: true })
  email: string

  @Column('varchar', { nullable: true })
  nickname?: string

  @CreateDateColumn()
  createdAt: Date

  @OneToMany(() => Photo, (photo) => photo.owner)
  photos: Photo[]
}

@ViewEntity('user_photo_counts')
export class UserPhotoCount {
  @Column()
  userId: number
}
