import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm'
import { User } from './user.entity'

@Entity()
export class PhotoAlbum {
  @PrimaryColumn()
  slug: string
}

@Entity()
export class Photo {
  @PrimaryColumn()
  id: string

  @Column()
  url: string

  @ManyToOne(() => User, (user) => user.photos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner: User
}
